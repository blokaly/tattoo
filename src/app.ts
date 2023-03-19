import {Telegraf} from 'telegraf'
import {APIGatewayProxyEvent, Context} from "aws-lambda"
import {tgGetBot, tgSetWebhook} from './telegram'
import {lookupSsm} from "./ssm"
import {logger} from './logging'
import {TELEGRAM_HEADER_SECRET_TOKEN} from "./constants";


type SetWebhookEvent = {
    setWebhook: boolean
}

type AuthoriseResponse = {
    isAuthorized: boolean
}

export const authorise = async (
    event: SetWebhookEvent | APIGatewayProxyEvent
): Promise<AuthoriseResponse | void> => {

    if ('setWebhook' in event && (<SetWebhookEvent>event).setWebhook) {
        logger.info('setting bot webhook')
        const {domain, path_key} = process.env
        let params: any = {url: `${domain}/${path_key}/`}
        const secretToken = await lookupSsm(process.env.secret_token)
        if (secretToken) {
            params = {...params, secret_token: secretToken}
        }
        await tgSetWebhook(params)
    } else {
        const secretToken = await lookupSsm(process.env.secret_token)
        if ((<APIGatewayProxyEvent>event).headers[TELEGRAM_HEADER_SECRET_TOKEN] === secretToken) {
            return {isAuthorized: true}
        } else {
            logger.info(`secret token does not match, reject event: ${JSON.stringify(event)}`)
            return {isAuthorized: false}
        }
    }
}

const handle = async (
    event: APIGatewayProxyEvent
): Promise<void> => {
    const update = JSON.parse((<APIGatewayProxyEvent>event).body)
    if (update.message) {
        const bot: Telegraf = await tgGetBot() || undefined
        await bot?.handleUpdate(update)
    } else {
        throw new Error(`Unknown event: ${update}`)
    }
}

exports.handler = async (event: APIGatewayProxyEvent, context: Context) => {
    logger.info(`processing event: ${JSON.stringify(event)}`)
    logger.defaultMeta = {requestId: context.awsRequestId}
    try {
        return await handle(event);
    } catch (error) {
        logger.error(error)
        return {statusCode: 500}
    }
}
