import puppeteer from "puppeteer";

import { Agent } from "@simple-browser-agent/core";
import environment from "./environment.js";

async function main() {
	// This is to ensure that the prompt is printed out *AFTER* that stupid punycode is deprecated warning...
	await new Promise((resolve) => setTimeout(resolve, 1000));

	const taskPrompt = await new Promise<string>((resolve) => {
		process.stdout.write("Enter task prompt: ");
		process.stdin.once("data", (data) => resolve(data.toString().trim()));
	});

	const browser = await puppeteer.launch({
		headless: false,
	});

	const agent = new Agent({
		task: taskPrompt,
		closeBrowserOnDone: false,

		browser: browser,

		apiBaseUrl: environment.API_BASE_URL,
		apiKey: environment.API_KEY,
		apiOrganization: environment.API_ORGANIZATION,
		apiProject: environment.API_PROJECT,
		modelId: environment.MODEL_ID,
		maxTokens: environment.MAX_TOKENS,
	});

	agent.start();

	// Wait for the agent to stop, then wait 10 seconds before closing the browser
	await new Promise((resolve) =>
		agent.addEventListener("stopped", () => setTimeout(resolve, 10000))
	);
	browser.close();

	process.exit(0);
}

main();
