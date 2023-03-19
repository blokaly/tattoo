import axios from 'axios'
import {lookupSsm} from "./ssm"
import {logger} from "./logging";
import {
    CHAT_MODE,
    CHAT_URL,
    COMPLETIONS_MAX_TOKEN,
    COMPLETIONS_MODE,
    COMPLETIONS_TEMPERATURE,
    COMPLETIONS_TOP_P,
    COMPLETIONS_URL
} from "./constants";

type OpenAICompletionsChoice = {
    text: string
    index: number
    finish_reason: string
}

type OpenAICompletionsResponse = {
    id: string
    created: number
    choices: [OpenAICompletionsChoice]
}

type OpenAIChatMessage = {
    role: string
    content: string
}

type OpenAIChatChoice = {
    message: OpenAIChatMessage
    index: number
    finish_reason: string
}

type OpenAIChatResponse = {
    id: string
    created: number
    choices: [OpenAIChatChoice]
}

const postOpenAICompletions = async (prompt: string): Promise<OpenAICompletionsResponse | void> => {
    try {
        const token = await lookupSsm(process.env.openai_token)
        const maxToken: number = process.env.openai_max_token ? Number(process.env.openai_max_token) : COMPLETIONS_MAX_TOKEN
        const temperature: number = process.env.openai_temperature ? Number(process.env.openai_temperature) : COMPLETIONS_TEMPERATURE
        if (token) {
            const {data} = await axios.post<OpenAICompletionsResponse>(
                COMPLETIONS_URL,
                {
                    model: COMPLETIONS_MODE,
                    prompt: prompt,
                    temperature: temperature,
                    max_tokens: maxToken,
                    top_p: COMPLETIONS_TOP_P
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/json',
                    },
                },
            )
            return data
        } else {
            logger.error('failed to retrieve openai_token')
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error('openai error message: ', error.response.status, error.message)
        } else {
            logger.error('unexpected openai error: ', error)
        }
    }
}

export const processCompletions = async (input: string): Promise<string> => {

    const answer = await postOpenAICompletions(input);
    if (answer) {
        return answer.choices[0].text
    } else {
        return "Ooops, something went wrong..."
    }
}

const postOpenAIChat = async (messages: OpenAIChatMessage[]): Promise<OpenAIChatResponse | void> => {
    try {
        const token = await lookupSsm(process.env.openai_token)

        if (token) {
            const {data} = await axios.post<OpenAIChatResponse>(
                CHAT_URL,
                {
                    model: CHAT_MODE,
                    messages: messages
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/json',
                    },
                },
            )
            return data
        } else {
            logger.error('failed to retrieve openai_token')
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error('openai error message: ', error.response.status, error.message)
        } else {
            logger.error('unexpected openai error: ', error)
        }
    }
}
export const processChat = async (prompt: string, question: string): Promise<string> => {
    const messages = [{role: "system", content: prompt}, {role: "user", content: question}]
    const answer = await postOpenAIChat(messages);
    if (answer) {
        return answer.choices[0].message.content
    } else {
        return "Ooops, something went wrong..."
    }
}
