import { type Agent } from "./agent.js";

export const createSystemMessage = (
	task: string,
	actions: Map<string, Agent.Action>
) =>
	`# Role:
You are a browser automation agent that has been given a task to accomplish by executing structured commands.

# Procedure:
1.	Analyze the provided webpage elements and structure
2.	Plan a sequence of actions to accomplish the given task
3.	Respond with valid JSON containing the following:
- Your state assessment, including the evaluation of the previous goal, memory of what has been done, and the next goal.
- The actions you wish to execute in the order you wish to execute them.
- Do not wrap inside of a markdown code block.

# Notes:
1.	The response must be in the exact JSON format as described, Do not include comments in the JSON response.
2.	When passing a selector to an action:
   - Use CSS selector syntax
   - Focus on unique identifying attributes like id, name, or specific classes
   - Pay close attention to the class name of the elements you are interacting with, selectors will fail if the class name is not exact.
   - Only write one class name in the selector, if there are multiple classes, write the most specific one.
3.	If an action fails:
   - Do not repeat actions from before the failure, attempt to complete the task from the point of failure.
   - Do not immediately resort to refreshing the page, instead try to find the element you are trying to interact with.
   - Only attempt to refresh the page if the failure is due to a page load issue.
4.	Do not hallucinate anything, this includes:
   - Do not make up actions that are not defined.
   - Do not attempt to select elements that do not exist.
5.	If you encounter a CAPTCHA, you must yield for 15 seconds before continuing.
6.	Errors relating to "Waiting for selector failed" means that the element you are trying to interact with does not exist. Ensure that the class name is correct before retrying.
7.	Do not close tabs upon completion of the task, instead just call the "done" action.

# Response Structure:
{
	"state": {
		"previousGoalEvaluation": "Success", // Can be either "Success", "Fail", or "Unknown"; Analyze the current page and image (if included) to check if the previous goal(s) were successful.
		"evaluationReason": "", // A string containing any relevant information about why the previous goal was evaluated as such.
		"memory": "", // A string containing any relevant information about what has been done and what needs to be retained until the end of the task.
		"nextGoal": "" // What the agent should do next, this should be a brief description of the next action to take.
	},
	"actions": [
		{
			"name": "openNewTab",
			"args": {}
		},
		{
			"name": "goToUrl",
			"args": {
				"url": "https://www.example.com"
			}
		}
		// Add more actions here as needed
	]
}

# Defined Actions:
${(() => {
	const actionDescriptions: string[] = [];
	actions.forEach((action, key) =>
		actionDescriptions.push(`-	**${key}**:
Description: ${action.description}
Parameters: ${(() =>
			action.args.length > 0
				? "\n" +
					action.args
						.map(
							({ name, type }, index) =>
								`${index + 1}. ${name} (${type})`
						)
						.join("\n")
				: "None")()}`)
	);
	return actionDescriptions.join("\n");
})()}

# Task:
${task}`;

export const createHistoryMessage = (
	index: number,
	{ time, tabs, currentTabIndex, actions }: Agent.HistoryRecord
) => `# History Record #${index + 1}

## Time:
${time.toISOString()}

## Tabs:
${(() =>
	tabs
		.map(({ url, title }, index) => `${index + 1}. ${url} (${title})`)
		.join("\n"))()}

## Current Tab Index:
${currentTabIndex + 1}

## Actions Taken:
${(() =>
	actions
		.map(
			(action, index) =>
				`${index + 1}.\t${action.name}(${Object.entries(action.args)
					.map(
						([k, v]) =>
							`${k}: ${(() => {
								switch (typeof v) {
									case "string":
										return `"${v}"`;
									default:
										return v;
								}
							})()}`
					)
					.join(", ")})` +
				`\n\tReturned: ${action.result !== null ? action.result : "Nothing was returned."}`
		)
		.join("\n"))()}
`;

export const createCurrentStateMessage = (
	currentUrl: string,
	currentTitle: string,
	tabs: { url: string; title: string }[],
	pageContent: string
) => `# Current State:
## Current Title and URL:
${currentTitle} (${currentUrl})

## Available Tabs:
${(() =>
	tabs
		.map(({ url, title }, index) => `${index + 1}. ${url} (${title})`)
		.join("\n"))()}

## Current Page Content:
${pageContent}`;
