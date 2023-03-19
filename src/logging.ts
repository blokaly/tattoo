import winston from 'winston';

const {combine, timestamp, json} = winston.format;

export const logger = winston.createLogger({
    level: process.env.log_level || 'info',
    format: combine(timestamp(), json()),
    transports: [new winston.transports.Console()],
    exitOnError: false
});
