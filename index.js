require('dotenv').config();

var redisURL = process.env.REDIS_URL || '127.0.0.1:6379';

const redis = require('redis');
const TelegramBot = require('node-telegram-bot-api');
let redisBase = redis.createClient(redisURL);

if (!process.env.TELEGRAMTOKEN) {
    console.error('Telegram API key was not set');
    process.exit(1);
}

let bot = null;
let botInfo = null;

const help = [
    'Hi. This is a bot which stores configuration of hardware\\mobile\\etc of users',
    'Written primarily for @ru2chhw',
    'Use */update* and write anything (less than 1000 chars) about your PC',
    'Use */show [user]* to watch user configuration.',
    'For example */show @GnuPetrovich* will show author\'s config.',
    'Using */show* without user will show all users config',
    'Use */deleteme* to delete your configuration from this conference',
    'Bot works only in groups',
    '',
    '',
    'Привет. Этот бот позволяет сохранять конфигурацию железа\\телефона\\прочего участников какой-либо конференции',
    'Написано специально для @ru2chhw',
    'Команда */update* позволяет записать вашу конфигурацию (до 1000 символов)',
    'Команда */show [пользователь]* покажет конфигурацию выбранного пользователя. Например */show @GnuPetrovich*',
    'Команда */deleteme* позволяет удалить вашу конфигурацию из памяти',
    'Если же пользователь не указан, то будет показана конфигурация всех пользователей в конференции',
    'Используйте только в группах'
];

// Are we on Heroku?
if (process.env.PORT && !isNaN(process.env.PORT)) {
    bot = new TelegramBot(process.env.TELEGRAMTOKEN, {
        webHook: {
            port: process.env.PORT
        }
    });
    bot.setWebHook(`${process.env.APPURL}/bot${process.env.TELEGRAMTOKEN}`);
    console.log('[Telegram] Running in webhook mode on heroku');
} else {
    bot = new TelegramBot(process.env.TELEGRAMTOKEN, {
        polling: true,
        request: {
            family: 6
        }
    });
    console.log('[Telegram] Running in polling mode');
}

bot.getMe().then(function(me) {
    botInfo = me;
    console.log('[Telegram] Telegram connection established. Logged in as:', me.username);
});

bot.onText(/\/update(@\w+)? ([^$]+)/, (msg, match) => {
    if (Math.abs(msg.date - Math.floor(Date.now() / 1000)) > 20) {
        return;
    }

    if (msg.chat.type !== 'private' && (!match[1] || match[1].substring(1) !== botInfo.username)) {
        console.log('No @ in group');
        return;
    }

    if(match[2].length >= 1000) {
        bot.sendMessage(msg.chat.id, 'Too long!');
    }

    redisBase.hset(msg.chat.id, msg.from.username.toLowerCase(), match[2], redis.print);

    bot.sendMessage(msg.chat.id, 'OK!').then((mymsg) => {
        setTimeout(() => {
            bot.deleteMessage(msg.chat.id, mymsg.message_id);
        }, 5000);
    })
});

bot.onText(/\/delete(@\w+) (.+)/, (msg, match) => {
    if (Math.abs(msg.date - Math.floor(Date.now() / 1000)) > 20) {
        return;
    }

    if (msg.chat.type !== 'private' && (!match[1] || match[1].substring(1) !== botInfo.username)) {
        console.log('No @ in group');
        return;
    }

    let user = match[2].toLowerCase();
    if (user.startsWith('@')) user = user.substring(1);

    bot.getChatAdministrators(msg.chat.id).then((admins) => {
        if (admins.some((admin) => {return admin.user.id === msg.from.id;})) {
            redisBase.hdel(msg.chat.id, user, redis.print);
            bot.sendMessage(msg.chat.id, 'OK');
        } else {
            bot.sendMessage(msg.chat.id, 'Admins only');
        }
    });
});

bot.onText(/\/deleteme(@\w+)?/, (msg, match) => {
    if (Math.abs(msg.date - Math.floor(Date.now() / 1000)) > 20) {
        return;
    }

    if (msg.chat.type !== 'private' && (!match[1] || match[1].substring(1) !== botInfo.username)) {
        console.log('No @ in group');
        return;
    }

    redisBase.hdel(msg.chat.id, msg.from.username.toLowerCase(), redis.print);

    bot.sendMessage(msg.chat.id, 'OK!').then((mymsg) => {
        setTimeout(() => {
            bot.deleteMessage(msg.chat.id, mymsg.message_id);
        }, 5000);
    })
});

bot.onText(/\/show(@\w+)?\s?(.*)/, (msg, match) => {
    if (Math.abs(msg.date - Math.floor(Date.now() / 1000)) > 20) {
        return;
    }

    if (msg.chat.type !== 'private' && (!match[1] || match[1].substring(1) !== botInfo.username)) {
        console.log('No @ in group');
        return;
    }

    let user = match[2].toLowerCase();
    if (user) {
        if (user.startsWith('@')) user = user.substring(1);
        redisBase.hget(msg.chat.id, user, (err, result) => {
            if (err) {
                if (process.env.ADMINID) {
                    bot.sendMessage(process.env.ADMINID, 'Error occurred. Query:' + match[0]);
                    bot.sendMessage(process.env.ADMINID, err);
                }
                bot.sendMessage(msg.chat.id, 'Error');
            }

            if (result) bot.sendMessage(msg.chat.id, `${match[2]}:\n${result}`, {
                parse_mode: 'markdown',
                disable_web_page_preview: true,
                disable_notification: true
            });
            if (!result) bot.sendMessage(msg.chat.id, `Not found!`);
        });
    } else {
        redisBase.hgetall(msg.chat.id, (err, keys) => {
            if (err) {
                if (process.env.ADMINID) {
                    bot.sendMessage(process.env.ADMINID, 'Error occurred. Query:' + match[0]);
                    bot.sendMessage(process.env.ADMINID, err);
                }
                bot.sendMessage(msg.chat.id, 'Error');
            }

            if (!keys) {
                bot.sendMessage(msg.chat.id, 'Empty');
                return;
            }

            let answer = Object.keys(keys).map((name) => {
                return `*${name}*:\n${keys[name]}`;
            }).join('\n');
            bot.sendMessage(msg.chat.id, answer, {
                parse_mode: 'markdown',
                disable_web_page_preview: true,
                disable_notification: true
            });
        });
    }
});

let welcomeMessage = (msg, match) => {
    if (Math.abs(msg.date - Math.floor(Date.now() / 1000)) > 20) {
        return;
    }

    if (msg.chat.type !== 'private' && (!match[1] || match[1].substring(1) !== botInfo.username)) {
        console.log('No @ in group');
        return;
    }

    bot.sendMessage(msg.chat.id, help.join('\n'), {
        parse_mode: 'Markdown'
    });
};

bot.onText(/\/help(@\w+)?/, welcomeMessage);
bot.onText(/\/start(@\w+)?/, welcomeMessage);

bot.on('polling_error', (error) => {
    console.log(error);
});