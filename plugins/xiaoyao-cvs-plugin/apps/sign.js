import User from "../model/user.js"
import moment from 'moment'

export const rule = {
    seach: {
        reg: `^#*(米游币|米币|云原神)查询$`,
        describe: "米游币、云原神查询"
    },
    cookiesDocHelp: {
        reg: "^#*(米游社|cookies|米游币|stoken|Stoken|云原神|云)(帮助|教程|绑定)$",
        describe: "cookies获取帮助"
    }
}

export async function cookiesDocHelp(e) {
    let user = new User(e)
    e.reply(`【${e.msg.replace(/帮助|教程|绑定/g, "")}帮助】${await user.docHelp(e.msg)}`)
    return true
}

export async function seach(e) {
    let user = new User(e)
    START = moment().unix()
    let res
    if (e.msg.includes('币')) {
        res = await user.bbsSeachSign()
    } else {
        res = await user.cloudSeach()
    }
    await replyMsg(e, res.message)
    return true
}

let START
async function replyMsg(e, resultMessage) {
    const END = moment().unix()
    Bot.logger.info(`运行结束, 用时 ${END - START} 秒`)
    resultMessage += `\n用时 ${END - START} 秒`
    e.reply([segment.at(e.user_id), "\n" + resultMessage])
}
