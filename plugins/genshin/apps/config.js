import plugin from '../../../lib/plugins/plugin.js'
import Cfg from '../model/Cfg.js'
import _ from 'lodash'

function numOrString(value) {
    return Number(value) || String(value)
}

export class config extends plugin {
    constructor() {
        super({
            name: 'genshin·配置',
            dsc: '签到等部分功能的配置',
            event: 'message',
            priority: Cfg.getConfig('config').priority,
            rule: [
                {
                    reg: '^#?签到(添加|删除)?(米币|游戏)白名单群.*$',
                    permission: 'master',
                    fnc: 'setGroupWhite'
                },
                {
                    reg: '^#?(米币)?签到(添加|删除)?(白名单|推送)(QQ|群)?.*$',
                    permission: 'master',
                    fnc: 'setwhite'
                },
                {
                    reg: '^#?(原神|星铁|绝区零|崩三|崩二|未定)?(禁用|解禁)(uid)?\\s*((1[0-9]|[1-9])[0-9]{8}|[1-9][0-9]{5,7})$',
                    fnc: 'banUid'
                }
            ]
        })
    }

    async setGroupWhite(e) {
        let white = Cfg.getConfig('white')
        let isCoin = e.msg.includes('米币')
        let key = isCoin ? 'bbsGroup' : 'gameGroup'
        if (!Array.isArray(white[key])) white[key] = []

        let action = e.msg.includes('添加') ? '添加' : e.msg.includes('删除') ? '删除' : '查看'
        let id = e.msg
            .replace(/^#?签到(添加|删除)?(米币|游戏)白名单群\s*/i, '')
            .trim()

        let botId = e.self_id ?? (Array.isArray(Bot.uin) ? Bot.uin[0] : Bot.uin)
        if (!id && e.group_id)
            id = `${botId}:${e.group_id}`
        else if (id && !id.includes(':'))
            id = `${botId}:${id}`

        if (action === '查看' || !id) {
            let name = isCoin ? '米币签到白名单群' : '游戏签到白名单群'
            let msg = white[key].length
                ? white[key].map((v, i) => `${i + 1}. ${v}`).join('\n')
                : `${name}为空`
            return e.reply(msg)
        }

        if (action === '添加') {
            if (white[key].includes(id))
                return e.reply(`群:${id}已在${isCoin ? '米币' : '游戏'}白名单中`)
            white[key].push(id)
            Cfg.setConfig('white', white)
            return e.reply(`已添加${isCoin ? '米币' : '游戏'}白名单群:${id}`)
        }

        let index = white[key].findIndex(v => String(v) === String(id))
        if (index === -1)
            return e.reply(`群:${id}未在${isCoin ? '米币' : '游戏'}白名单中`)

        white[key].splice(index, 1)
        Cfg.setConfig('white', white)
        return e.reply(`已删除${isCoin ? '米币' : '游戏'}白名单群:${id}`)
    }

    async setwhite(e) {
        let white = Cfg.getConfig('white')
        let isCoin = /^#?米币签到/.test(e.msg)
        let isPush = e.msg.includes('推送')
        let isGroup = e.msg.includes('群') || isPush

        let key
        if (isPush)
            key = isCoin ? 'bbsPush' : 'signPush'
        else
            key = isCoin ? 'bbsQQ' : 'QQ'

        if (!Array.isArray(white[key])) white[key] = []

        let action = e.msg.includes('添加') ? '添加' : e.msg.includes('删除') ? '删除' : '查看'
        let id = e.msg
            .replace(/^#?(米币)?签到(添加|删除)?(白名单|推送)(QQ|群)?\s*/i, '')
            .trim()

        if (!id) {
            if (isGroup && e.group_id) {
                let botId = e.self_id ?? (Array.isArray(Bot.uin) ? Bot.uin[0] : Bot.uin)
                id = `${botId}:${e.group_id}`
            } else if (!isGroup) id = e.user_id
        } else if (isGroup && !id.includes(':')) {
            let botId = e.self_id ?? (Array.isArray(Bot.uin) ? Bot.uin[0] : Bot.uin)
            id = `${botId}:${id}`
        } else if (!isGroup) {
            id = numOrString(id)
        }

        if (action === '查看') {
            let msg = white[key].length
                ? white[key].map((v, i) => `${i + 1}. ${v}`).join(', ')
                : '暂无白名单'
            return e.reply(msg, false)
        }

        if (action === '添加') {
            if (white[key].some(v => String(v) === String(id)))
                return e.reply(`${isGroup ? '群' : 'QQ'}:${id}已在${isPush ? '推送' : '白'}名单中`)
            white[key].push(id)
            Cfg.setConfig('white', white)
            return e.reply(`已添加${isPush ? '推送' : '白'}名单${isGroup ? '群' : 'QQ'}:${id}`)
        }

        let index = white[key].findIndex(v => String(v) === String(id))
        if (index === -1)
            return e.reply(`${isGroup ? '群' : 'QQ'}:${id}未在${isPush ? '推送' : '白'}名单中`)

        white[key].splice(index, 1)
        Cfg.setConfig('white', white)
        return e.reply(`已删除${isPush ? '推送' : '白'}名单${isGroup ? '群' : 'QQ'}:${id}`)
    }

    async banUid(e) {
        let uid = Number(e.msg.replace(/#?(原神|星铁|绝区零|崩三|崩二|未定)?(禁用|解禁)(uid)?\s*/i, '').trim())

        if (!uid) return e.reply('未输入UID')

        let Uid = Cfg.getConfig('banuid')

        let name = e.msg.includes('未定') ? '未定' : e.msg.includes('崩二') ? '崩二' : e.msg.includes('崩三') ? '崩三' : e.msg.includes('绝区零') ? '绝区零' : e.msg.includes('星铁') ? '星铁' : '原神'
        let set = Uid[e.msg.includes('未定') ? 'wd' : e.msg.includes('崩二') ? 'bh2' : e.msg.includes('崩三') ? 'bh3' : e.msg.includes('绝区零') ? 'zzz' : e.msg.includes('星铁') ? 'sr' : 'gs']
        let action = e.msg.includes('禁用') ? '禁用' : '解禁'
        let g = e.msg.includes('未定') ? 'wd' : e.msg.includes('崩二') ? 'bh2' : e.msg.includes('崩三') ? 'bh3' : e.msg.includes('绝区零') ? 'zzz' : e.msg.includes('星铁') ? 'sr' : 'gs'

        if (!e.isMaster) {
            let { cks } = await Cfg.getcks(false, e.user_id)
            if (_.isEmpty(cks[g]))
                return e.reply('未绑定ck,或此UID已禁用', false, { at: true })
            if (!cks[g][uid])
                return e.reply(`只能${action}自己已绑ck的uid\n或此UID已禁用`)
        }

        if (action === '禁用') {
            if (set && set.includes(uid))
                return e.reply(`${name}UID:${uid}已禁用`)

            set.push(uid)
            Cfg.setConfig('banuid', Uid)
            return e.reply(`已${action}${name}UID:${uid}`)
        }

        if (set.length === 0)
            return e.reply('未添加禁用UID')

        let index = set.findIndex(q => q == uid)
        if (index !== -1) {
            set.splice(index, 1)
            Cfg.setConfig('banuid', Uid)
            return e.reply(`已${action}${name}UID:${uid}`)
        }
        return e.reply(`${name}UID:${uid}未禁用`)
    }
}
