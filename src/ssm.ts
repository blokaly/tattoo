import {GetParameterCommand, SSMClient} from "@aws-sdk/client-ssm"
import {GetParameterCommandOutput} from "@aws-sdk/client-ssm/dist-types/commands/GetParameterCommand"
import {logger} from "./logging";

const client = new SSMClient({})

const ttl: number = 3_600_000 // 1 hour

class ValueHolder {
    key: string
    data: string | void
    deferred: Promise<string | void>
    updatedAt: number

    constructor(key: string) {
        this.key = key
        this.updatedAt = 0
        this.deferred = null
    }

    isCached(): boolean {
        return Boolean(this.data)
    }

    isFresh(): boolean {
        return Date.now() - this.updatedAt < ttl
    }

    isFetching(): boolean {
        return Boolean(this.deferred)
    }

    fetch(): Promise<string | void> {
        this.deferred = client.send(new GetParameterCommand({Name: this.key, WithDecryption: true}))
            .then((result: GetParameterCommandOutput) => {
                this.updatedAt = Date.now()
                this.data = result.Parameter.Value
                return this.data
            }).catch((error: Error) => {
                logger.error('unexpected ssm error: ', error.message)
                this.data = null
            }).finally(() => {
                this.deferred = null
            })

        return this.deferred
    }

    async getValue(): Promise<string | void> {

        if (this.isFresh() && this.isCached()) {
            return this.data
        }

        if (this.isFetching()) {
            return this.deferred
        }

        return this.fetch()
    }
}

const cache: Map<string, ValueHolder> = new Map<string, ValueHolder>()


export const lookupSsm = async (name: string): Promise<string | void> => {

    if (!cache.has(name)) {
        cache.set(name, new ValueHolder(name))
    }
    return await cache.get(name).getValue()


}
