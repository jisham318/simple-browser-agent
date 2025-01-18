import { configDotenv } from "dotenv";

configDotenv();

interface Environment {
	readonly API_BASE_URL?: string;
	readonly API_KEY: string;
	readonly API_ORGANIZATION?: string;
	readonly API_PROJECT?: string;
	readonly MODEL_ID?: string;
	readonly MAX_TOKENS?: number;
}

const environment: Environment = {
	API_BASE_URL: process.env.API_BASE_URL,
	API_KEY: process.env.API_KEY ?? "",
	API_ORGANIZATION: process.env.API_ORGANIZATION,
	API_PROJECT: process.env.API_PROJECT,
	MODEL_ID: process.env.MODEL_ID,
	MAX_TOKENS: parseInt(process.env.MAX_TOKENS ?? "100000"),
};

export default environment;
