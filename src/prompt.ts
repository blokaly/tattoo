import prompts from './prompts.json'

const Polyglot = require('node-polyglot')
const polyglots = new Map()

for (const [key, value] of Object.entries(prompts)) {
    const p = new Polyglot()
    p.extend(value)
    polyglots.set(key, p)
}

export const getPrompt = (locale: string, key: string) => polyglots.get(locale).t(key)
