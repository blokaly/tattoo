import axios from 'axios'
import {lookupSsm} from "./ssm"
import {Context, Telegraf} from "telegraf";
import {message} from 'telegraf/filters';
import {processChat, processCompletions} from "./openai";
import {logger} from "./logging";
import {TELEGRAM_BOT_URL} from "./constants";
import {getPrompt} from "./prompt";

export const tgSetWebhook = async (msg: any): Promise<any | void> => {
    try {
        const token = await lookupSsm(process.env.bot_token)
        if (token) {
            const {data} = await axios.post(
                `${TELEGRAM_BOT_URL}${token}/setWebhook`,
                msg,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                },
            ).catch()
            return data
        } else {
            logger.error('error retrieving bot token to telegram, message: ', msg)
        }
    } catch (error) {
        logger.error('error sending message to telegram, message: ', msg)
        if (axios.isAxiosError(error)) {
            logger.error('telegram error message: ', error.response.status, error.message)
        } else {
            logger.error('unexpected telegram error: ', error)
        }
    }
}

const onStart = (bot: Telegraf<Context>) => {
    bot.start(ctx => {
        return ctx.reply("Hello from tattoo!")
    })
}

const onText = (bot: Telegraf<Context>) => {
    bot.on(message('text'), async (ctx) => {
        const answer = await processCompletions(ctx.message.text)
        return ctx.reply(answer)
    })
}

const onPoetCommand = (bot: Telegraf<Context>) => {
    const cmd = 'poet'
    bot.command(cmd, async (ctx) => {
        const answer = await processChat(getPrompt('en', cmd), ctx.message.text)
        return ctx.reply(answer)
    })
}


export const tgGetBot = async (): Promise<Telegraf | void> => {
    const token = await lookupSsm(process.env.bot_token)
    if (token) {
        const bot = new Telegraf(token, {});
        bot.catch((err, ctx) => {
            logger.error(`Ooops, telegraf encountered an error for ${ctx.updateType}`, err)
        })
        bot.use(Telegraf.log(logger.debug));
        bot.use(async (ctx, next) => {
            await ctx.sendChatAction('typing')
            return next()
        })
        onStart(bot)
        onText(bot)
        onPoetCommand(bot)
        return bot
    }
}
