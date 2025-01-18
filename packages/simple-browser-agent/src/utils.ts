import { JSDOM } from "jsdom";
import prettier from "prettier";

export function getParamNames(func: (...args: unknown[]) => unknown): string[] {
	// Convert function to string and match parameter names
	const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
	const ARGUMENT_NAMES = /([^\s,]+)/g;
	const funcStr = func.toString().replace(STRIP_COMMENTS, "");
	const result = funcStr
		.slice(funcStr.indexOf("(") + 1, funcStr.indexOf(")"))
		.match(ARGUMENT_NAMES);
	return result || [];
}

export async function sleep(ms: number = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const TAGS_TO_REMOVE = [
	"script",
	"style",
	"aside",
	"footer",
	"header",
	"hgroup",
	"nav",
	"search",
];

const ATTRIBUTES_TO_KEEP = [
	"id",
	"name",
	"href",
	"src",
	"alt",
	"title",
	"aria-label",
	"jsname",
];

export async function sanitizeHTML(html: string): Promise<string> {
	// Create a DOM object that we can manipulate from the HTML
	const dom = new JSDOM(html);

	// Remove the tags we don't want
	TAGS_TO_REMOVE.forEach((tag) =>
		Array.from(dom.window.document.getElementsByTagName(tag)).forEach((e) =>
			e.remove()
		)
	);

	// Keep only the attributes we want
	Array.from(dom.window.document.querySelectorAll("*")).forEach((e) => {
		Array.from(e.attributes).forEach(
			(attr) =>
				!ATTRIBUTES_TO_KEEP.includes(attr.name) &&
				e.removeAttribute(attr.name)
		);
	});

	// Format the HTML to have proper indentation and newlines
	return prettier.format(dom.window.document.documentElement.outerHTML, {
		parser: "html",
		printWidth: 80,
		tabWidth: 2,
		useTabs: false,
		htmlWhitespaceSensitivity: "ignore",
	});
}
