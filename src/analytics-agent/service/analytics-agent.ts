import { createAgent, HumanMessage } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { GoogleAuth } from "google-auth-library";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ChatOpenAI } from "@langchain/openai";
import z from "zod"
import { AGENT_SYSTEM_PROMPT } from "../constants/analytics-agent.constants";

const LLM = new ChatOpenAI({
    model : process.env.OPENAI_CHAT_MODEL,
    apiKey : process.env.OPENAI_API_KEY
})

const outputSchema = z.object({
    response : z.string(),
    followUps : z.array(z.string()).optional()
})

const checkpointer = "yet to be decided"

const google = new GoogleAuth({
    scopes : ["https://www.googleapis.com/auth/bigquery"],
})

const authProvider: OAuthClientProvider = {
    get redirectUrl() {
        return undefined
    },
    get clientMetadata() {
        return { redirect_uris: [] }
    },
    clientInformation: () => undefined,
    tokens: async () => {
        const accessToken = await google.getAccessToken()
        if (!accessToken) {
            throw new Error("Failed to obtain a Google access token for the BigQuery MCP server")
        }
        return { access_token: accessToken, token_type: "Bearer" }
    },
    saveTokens: () => {},
    redirectToAuthorization: () => {
        throw new Error("Interactive OAuth is not supported; tokens come from GoogleAuth")
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => {
        throw new Error("Interactive OAuth is not supported; tokens come from GoogleAuth")
    },
}

// mcp connection works (tested)
const client = new MultiServerMCPClient({
    mcpServers : {
        bigQuery: {
            transport: "http",
            url: "https://bigquery.googleapis.com/mcp",
            authProvider
        },
    }
});

const AVAILABLE_TABLES = {
    "projectId.datasetId.tableId" : "desc about the table",
    "gen-lang-client-0422477371.test_set.test_table" : "contains some test data for testing purposes"
}


export async function invokeAnalyticalAgent(query : string , userId? : string , chatId? : string){
    const tools = await client.getTools()
    
    const agent = createAgent({
        model : LLM,
        systemPrompt : AGENT_SYSTEM_PROMPT.replace("{{AVAILABLE_TABLES}}",JSON.stringify(AVAILABLE_TABLES)),
        responseFormat : outputSchema,
        tools,
    })

    const answer = await agent.invoke({
        messages : [new HumanMessage(query)],
    })

    const toolCalls = answer.messages.filter((el)=> el.type === "ai").flatMap((el)=>el.additional_kwargs.tool_calls)

    return {
        toolCalls,
        response : answer.structuredResponse
    }

}
