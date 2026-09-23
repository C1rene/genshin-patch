import plugin from '../../../lib/plugins/plugin.js'
import common from '../../../lib/common/common.js'
import BBsSign from '../model/bbsSign.js'
import MysSign from '../model/sign.js'
import Cfg from '../model/Cfg.js'
import SignPermission from '../model/SignPermission.js'
import SignQueue from '../model/SignQueue.js'
import SignTaskState from '../model/SignTaskState.js'
import moment from 'moment'

let START
let command = Cfg.getConfig('command')

export class sign extends plugin {
    constructor() {
        super({
            name: 'genshin·签到',
            dsc: '游戏及社区签到',
            event: 'message',
            priority: Cfg.getConfig('config').priority,
            rule: [
                {
                    reg: '^#?(重新)?(全部签到|签到任务)$',
                    permission: 'master',
                    fnc: 'Task'
                },
                {
                    reg: '^#?米币(重新)?(全部签到|签到任务)$',
                    permission: 'master',
                    fnc: 'bbsTask'
                },
                {
                    reg: '^#?社区全部签到$',
                    permission: 'master',
                    fnc: 'communityTask'
                },
                {
                    reg: `^#?${command.sign}$`,
                    fnc: 'sign',
                },
                {
                    reg: '^#?(米币|米游币)签到$',
                    fnc: 'coinSign',
                },
                {
                    reg: `^#?${command.bbssign}$`,
                    fnc: 'bbsSign',
                }
            ]
        })

        this.config = Cfg.getConfig('config')
        this.task = [
            {
                cron: this.config.signTime,
                name: '签到任务',
                fnc: () => this.Task(null, true)
            },
            {
                cron: this.config.bbsSignTime,
                name: '米币签到任务',
                fnc: () => this.bbsTask(null, true)
            }
        ]
    }

    async Task(e, fromCron = false) {
        e = fromCron ? {} : (e || this.e)
        let manual = !fromCron
        let targetQQs = manual ? await SignPermission.getMasterTargets(e, 'game') : null

        if (fromCron) SignTaskState.begin('game')
        try {
            await new MysSign(e).signTask(manual, targetQQs)
        } finally {
            if (fromCron) SignTaskState.end('game')
        }
        return
    }

    async bbsTask(e, fromCron = false) {
        e = fromCron ? {} : (e || this.e)
        let manual = !fromCron
        let targetQQs = manual ? await SignPermission.getMasterTargets(e, 'coin') : null

        if (fromCron) SignTaskState.begin('coin')
        try {
            await new BBsSign(e).bbsTask(manual, targetQQs)
        } finally {
            if (fromCron) SignTaskState.end('coin')
        }
        return
    }

    async communityTask(e) {
        e = e || this.e
        await e.reply('正在签到中······')

        let targetQQs = await SignPermission.getMasterTargets(e, 'coin')
        if (!targetQQs.length) {
            await e.reply('暂无sk需要社区签到')
            return
        }

        START = moment().unix()
        let results = await BBsSign.communityTask(e, targetQQs)
        let END = moment().unix()

        let nodes = []
        for (let item of results) {
            let text = `QQ：${item.qq}\n${item.message || '无可用stoken或无签到结果'}`
            nodes.push(text)
        }
        nodes.push(`总用时 ${END - START} 秒`)

        let forward = await common.makeForwardMsg(e, nodes, '社区全部签到结果')
        await e.reply(forward)
        return
    }

    async sign(e) {
        if (!await this.checkAccess(e, 'game')) return
        if (!SignQueue.tryAcquire(e.user_id, 'game'))
            return e.reply('前置签到正在执行中')

        try {
            await MysSign.sign(e)
        } finally {
            SignQueue.release(e.user_id, 'game')
        }
        return
    }

    async coinSign(e) {
        if (!await this.checkAccess(e, 'coin')) return
        if (!SignQueue.tryAcquire(e.user_id, 'coin'))
            return e.reply('前置签到正在执行中')

        try {
            await e.reply('正在签到中······')

            let list = await BBsSign.coinSign(e)
            let success = Array.isArray(list) && list.length > 0 &&
                list.every(res => res?.retcode === 0 || res?.retcode === 100)

            await e.reply(success ? '米币签到完成' : '米币签到失败')
        } finally {
            SignQueue.release(e.user_id, 'coin')
        }
        return
    }

    async bbsSign(e) {
        if (!await this.checkAccess(e, 'coin')) return
        if (!SignQueue.tryAcquire(e.user_id, 'coin'))
            return e.reply('前置签到正在执行中')

        try {
            START = moment().unix()
            let msg = e.msg?.replace(/(米游社|mys|社区|签到|#)/g, '')
            if (msg === '全部') await e.reply('正在签到中······')

            let list = await BBsSign.bbsSign(e, msg)
            if (!list) return

            let send = []
            for (let res of list)
                if (res?.message) send.push(res.message)

            await this.replyMsg(e, send)
        } finally {
            SignQueue.release(e.user_id, 'coin')
        }
        return
    }

    async replyMsg(e, msgs) {
        const END = moment().unix()
        logger.info(`社区签到结束, 用时 ${END - START} 秒`)
        let msg = msgs.filter(Boolean).join('\n')
        msg += `${msg ? '\n' : ''}用时 ${END - START} 秒`
        await e.reply(msg)
        return
    }

    async checkAccess(e, level) {
        if (e.isMaster) return true

        let permission = await SignPermission.getPermission(e.user_id)
        if (!SignPermission.hasLevel(permission, level)) {
            await e.reply('暂无签到权限')
            return false
        }

        if (SignTaskState.isRunning(level)) {
            await e.reply('自动签到任务执行中，禁止手动签到')
            return false
        }

        if (SignPermission.isBeforeManualTime(level)) {
            await e.reply('非签到时间')
            return false
        }

        return true
    }
}
