import "reflect-metadata";

import OpenAI from "openai";
import { Browser, ElementHandle, KeyInput, Page } from "puppeteer";

import {
	createCurrentStateMessage,
	createHistoryMessage,
	createSystemMessage,
} from "./messages.js";
import { getParamNames, sanitizeHTML, sleep } from "./utils.js";

export declare namespace Agent {
	export interface ConstructorArgs {
		// Agent settings
		readonly task: string;
		readonly closeBrowserOnDone?: boolean;
		readonly maxSteps?: number;

		// Puppeteer settings
		readonly browser: Browser;

		// OpenAI settings
		readonly apiKey: string;
		readonly apiBaseUrl?: string;
		readonly apiOrganization?: string;
		readonly apiProject?: string;
		readonly modelId?: string;
		readonly maxTokens?: number;
	}

	export interface Action {
		readonly args: { name: string; type: string }[];
		readonly description: string;
		readonly callback: Function;
	}

	export interface LLMResponse {
		readonly state: {
			readonly previousGoalEvaluation: "Success" | "Fail" | "Unknown";
			readonly evaluationReason: string;
			readonly memory: string;
			readonly nextGoal: string;
		};
		readonly actions: {
			readonly name: string;
			readonly args: { [paramName: string]: unknown };
		}[];
	}

	export interface HistoryRecord {
		readonly time: Date;
		readonly tabs: { readonly url: string; readonly title: string }[];
		readonly currentTabIndex: number;
		readonly state: LLMResponse["state"];
		readonly actions: {
			readonly name: string;
			readonly args: { [paramName: string]: unknown };
			readonly success: boolean;
			readonly result: unknown | null;
		}[];
	}
}

export class Agent extends EventTarget {
	// Agent
	private readonly closeBrowserOnDone: boolean;
	private readonly task: string;
	private readonly maxSteps: number;
	private readonly actions: Map<string, Agent.Action> = new Map();
	private readonly history: Agent.HistoryRecord[] = [];

	private _running: boolean = false;
	public get running() {
		return this._running;
	}

	private _stopped: Event = new Event("stopped");
	private _completed: Event = new Event("completed");

	// Puppeteer
	private browser: Browser;

	// OpenAI
	private readonly api: OpenAI;
	private readonly model: string;
	private readonly maxTokens: number;

	// #region Static methods

	private static pendingActions: Map<string, Agent.Action> = new Map();
	public static DefineAction(description: string) {
		return function (
			target: Agent,
			methodName: string,
			descriptor: PropertyDescriptor
		): PropertyDescriptor {
			const paramNames: string[] = getParamNames(descriptor.value);
			const paramTypes: string[] = (
				Reflect.getMetadata("design:paramtypes", target, methodName) ??
				[]
			).map((type: (...args: unknown[]) => unknown) => type.name);

			const action: Agent.Action = {
				args: paramNames.map((name, index) => ({
					name,
					type: paramTypes[index],
				})),
				description,
				callback: descriptor.value,
			};
			Agent.pendingActions.set(methodName, action);

			return descriptor;
		};
	}

	// #endregion

	// #region Constructor

	constructor({
		// Agent settings
		task,
		closeBrowserOnDone = true,
		maxSteps = 100,

		// Puppeteer settings
		browser,

		// OpenAI settings
		apiKey,
		apiBaseUrl = "https://api.openai.com/v1",
		apiOrganization,
		apiProject,
		modelId = "gpt-4o-mini",
		maxTokens = 100000,
	}: Agent.ConstructorArgs) {
		super(); // Call EventTarget constructor

		// Setup Agent
		this.closeBrowserOnDone = closeBrowserOnDone;
		this.task = task;
		this.maxSteps = maxSteps;

		// Setup Puppeteer
		this.browser = browser;

		// Setup OpenAI
		this.api = new OpenAI({
			apiKey,
			baseURL: apiBaseUrl,
			organization: apiOrganization,
			project: apiProject,
		});
		this.model = modelId;
		this.maxTokens = maxTokens;

		// Register all pending actions
		for (const [name, action] of Agent.pendingActions) {
			this.actions.set(name, action);
			Agent.pendingActions.delete(name);
		}
	}

	// #endregion

	//#region Private methods

	private async getCurrentPage(): Promise<Page | null> {
		const pages = await this.browser.pages();
		const vis_results = await Promise.all(
			pages.map(async (p) => {
				try {
					return await p
						.waitForSelector("html")
						.then(() => p.evaluate(() => !document.hidden));
				} catch {
					return false;
				}
			})
		);
		return pages.filter((_v, index) => vis_results[index])[0] ?? null;
	}

	private async selectElementHandle(
		selector: string
	): Promise<ElementHandle | null> {
		return this.getCurrentPage().then(
			(p) => p?.waitForSelector(selector, { timeout: 1000 }) ?? null
		);
	}

	private async getCurrentBrowserState() {
		const page = await this.getCurrentPage();
		const pages = await this.browser.pages();
		return {
			url: page?.url() ?? "",
			title: (await page?.title()) ?? "",
			currentTabIndex: pages.findIndex(
				async (p) =>
					await p
						.waitForSelector("html")
						.then(() => p.evaluate(() => !document.hidden))
			),
			tabs: await Promise.all(
				pages.map(async (p) =>
					p.waitForSelector("html").then(async () => ({
						url: p.url(),
						title: await p.title(),
					}))
				)
			),
			content: (await page?.content().then(sanitizeHTML)) ?? "",
		};
	}

	private async generateMessages() {
		const bState = await this.getCurrentBrowserState();
		return {
			system: createSystemMessage(this.task, this.actions),
			history: this.history.map((h, i) => createHistoryMessage(i, h)),
			currentState: createCurrentStateMessage(
				bState.url,
				bState.title,
				bState.tabs,
				bState.content
			),
		};
	}

	private async purgeHistory() {
		// TODO: Implement this
	}

	private async showDebugPage() {
		const msgs = await this.generateMessages();
		await this.openNewTab();
		this.goToDataUrl(
			`${msgs.system}\n${msgs.history.join("\n")}\n${msgs.currentState}`,
			"text/plain"
		);
	}

	private async step() {
		const msgs = await this.generateMessages();
		await this.api.chat.completions
			.create({
				model: this.model,
				messages: [
					{
						role: "system",
						content: [
							{
								type: "text",
								text: msgs.system,
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "text",
								text: msgs.history.join("\n"),
							},
							{
								type: "text",
								text: msgs.currentState,
							},
						],
					},
				],
			})
			.then(async (completion) => {
				const responseString = completion.choices[0].message
					.content as string;

				let response: Agent.LLMResponse;
				try {
					response = JSON.parse(responseString);
				} catch {
					console.log(
						`Failed to parse API response as JSON: ${responseString}`
					);
					return;
				}

				let i = 0;
				const actionResults: {
					success: boolean;
					result: unknown | null;
				}[] = [];
				for (const { name, args } of response.actions) {
					if (!this._running) {
						console.log(
							"No longer running, stopping execution of current actions"
						);
						break;
					}

					const action: Agent.Action | undefined =
						this.actions.get(name);
					if (!action) {
						console.log(`Action ${name} not found`);
						i++;
						continue;
					}

					console.log(`Executing action ${name} with args:`, args);
					actionResults[i] = await action.callback
						.bind(this, ...Object.values(args))()
						.then((result: unknown | null) => ({
							success: true,
							result: result ?? null,
						}))
						.catch((error: unknown) => {
							console.log(
								`Failed to execute action ${name}: ${error}`
							);
							return { success: false, result: error };
						});
					i++;
				}

				const bState = await this.getCurrentBrowserState();
				this.history.push({
					time: new Date(),
					tabs: bState.tabs,
					currentTabIndex: bState.currentTabIndex,
					state: response.state,
					actions: response.actions.map(({ name, args }, index) => ({
						name,
						args,
						success: actionResults[index].success,
						result: actionResults[index].result,
					})),
				});
			})
			.catch(async (error) => {
				let delay = 1000;
				if (error instanceof OpenAI.APIError) {
					console.log(
						`API error: ${error.status} ${error.message} ${error.code}`
					);
					if (error.code === "rate_limit_exceeded") {
						// TODO: Purge history
						console.log(
							`Rate limit exceeded, waiting for 60 seconds`
						);
						delay = 60000;
					} else if (error.code === "token_limit_exceeded") {
						// TODO: Purge history instead of stopping execution
						console.error(
							`Token limit exceeded, stopping execution.`
						);
						this._running = false;
					}
				} else {
					console.log(`Runtime error: ${error}`);
				}
				await this.sleep(delay);
			});
	}

	//#endregion

	//#region Public methods

	public async start() {
		if (this._running) return;
		this._running = true;

		let stepCount = 0;
		while (this._running && stepCount < this.maxSteps)
			await this.step().finally(() => stepCount++);
		this.stop();
		this.dispatchEvent(this._completed);
	}

	public async stop() {
		if (this.closeBrowserOnDone) {
			this.browser.close();
		} else {
			this.showDebugPage();
		}
		this._running = false;
		this.dispatchEvent(this._stopped);
	}

	//#endregion

	//#region Actions

	@Agent.DefineAction("Open a new tab with the given url")
	public async openNewTab() {
		console.log(`Opening new tab`);
		await this.browser.newPage().then((p) => p.bringToFront());
	}

	@Agent.DefineAction("Go to the given url")
	public async goToUrl(url: string) {
		console.log(`Navigating to URL: ${url}`);
		await this.getCurrentPage().then((p) =>
			Promise.all([
				p?.goto(url),
				p?.waitForNavigation({
					waitUntil: "domcontentloaded",
					timeout: 10000,
				}),
			])
		);
	}

	@Agent.DefineAction(
		'Go to a page with the given text displayed, supported content types are: "text/html" and "text/plain"'
	)
	public async goToDataUrl(
		content: string,
		contentType: "text/html" | "text/plain"
	) {
		await this.goToUrl(
			`data:${contentType};base64,${Buffer.from(content).toString("base64")}`
		);
	}

	@Agent.DefineAction(
		"Marks the task as complete, breaking the execution loop."
	)
	public async done() {
		console.log("Marking task as complete");
		this._running = false;
	}

	@Agent.DefineAction("Close the current tab")
	public async closeTab() {
		console.log(`Closing current tab`);
		await this.getCurrentPage().then((p) => p?.close());
	}

	@Agent.DefineAction("Navigate back to the previous page")
	public async goBack() {
		console.log(`Going back to previous page`);
		await this.getCurrentPage().then((p) => p?.goBack());
	}

	@Agent.DefineAction("Refreshes the current page")
	public async refresh() {
		console.log(`Refreshing current page`);
		await this.getCurrentPage().then((p) => p?.reload());
	}

	@Agent.DefineAction("Switch to the tab at the given index (1-based)")
	public async switchTab(index: number) {
		console.log(`Switching to tab ${index}`);
		const pages = await this.browser.pages();
		if (index >= 1 && index <= pages.length) {
			await pages[index - 1].bringToFront();
		} else {
			throw new Error(
				`Tab index ${index} out of bounds (1 - ${pages.length})`
			);
		}
	}

	@Agent.DefineAction(
		"Scroll down the page by the specified number of pixels, positive is down, negative is up"
	)
	public async scroll(amount: number) {
		console.log(`Scrolling ${amount > 0 ? "down" : "up"} ${amount}px`);
		await this.getCurrentPage().then((p) =>
			p?.evaluate((pixels) => window.scrollBy(0, pixels), amount)
		);
	}

	@Agent.DefineAction("Clicks the element matching the given selector")
	public async clickElement(selector: string) {
		console.log(`Clicking element: ${selector}`);
		await this.selectElementHandle(selector).then((eh) => eh?.click());
	}

	@Agent.DefineAction("Inputs the value into the currently selected element")
	public async inputText(
		selector: string,
		value: string,
		clearBeforeInput: boolean = true
	) {
		console.log(`Inputting text: ${value}`);
		const handle = await this.selectElementHandle(selector);
		if (!handle) throw new Error(`Element ${selector} not found`);
		if (clearBeforeInput)
			await handle.evaluate((el) => el.setAttribute("value", ""));
		await handle.click();
		await handle.type(value);
	}

	@Agent.DefineAction(
		"Send a key press event to the currently selected element"
	)
	public async sendKey(selector: string, key: string) {
		console.log(`Sending key ${key} to element: ${selector}`);
		await this.selectElementHandle(selector).then((eh) =>
			eh?.press(key as KeyInput)
		);
	}

	@Agent.DefineAction(
		"Pauses the action loop for the given number of milliseconds. Be conservative with your sleep calls, they should only be used when necessary."
	)
	public async sleep(ms: number) {
		console.log(`Sleeping for ${ms}ms`);
		await sleep(ms);
	}

	//#endregion
}
