import User from "./user.js";
import utils from './mys/utils.js';
export default class mysTopLogin {
    constructor(e) {
        this.e = e;
        this.init();
        //消息提示以及风险警告
        this.sendMsgUser = `免责声明:您将通过扫码完成获取米游社sk以及ck。\n本Bot将不会保存您的登录状态。\n我方仅提供米游社查询及相关游戏内容服务,若您的账号封禁、被盗等处罚与我方无关。\n害怕风险请勿扫码~`
        this.sendMsgUserPassLogin = `免责声明:您将通过密码完成获取米游社sk以及ck。\n本Bot将不会保存您的账号和密码。\n我方仅提供米游社查询及相关游戏内容服务,若您的账号封禁、被盗等处罚与我方无关。\n害怕风险请勿发送账号密码~`
    }
    async init() {
        this.user = new User(this.e)
    }
    //
    async qrCodeLogin() {
        let RedisData = await utils.redisGet(this.e.user_id, "GetQrCode")
        if (RedisData) {
            this.e.reply([segment.at(this.e.user_id), `前置二维码未扫描，请勿重复触发指令`])
            return false;
        }
        this.device = await utils.randomString(16)
        this.e.reply(this.sendMsgUser)
        let res = await this.user.getData("qrCodeLogin", {
            device: this.device
        },false)
        if (!res.data) {
            return false;
        }
        res.data["ticket"] = res.data["ticket"] || res?.data?.url.split("ticket=")[1]
        return res
    }
    async GetQrCode(ticket, onScanned) {
        await utils.redisSet(this.e.user_id, "GetQrCode", { GetQrCode: 1 }, 60 * 5) //设置5分钟缓存避免重复触发
        let res;
        let RedisData = await utils.redisGet(this.e.user_id, "GetQrCode")
        let hasScanned = false
        let confirmed = false
        for (let n = 1; n < 60; n++) {
            await utils.sleepAsync(5000)
            res = await this.user.getData("qrCodeQuery", {
                device: this.device, ticket
            },false)
            if (res?.data?.status == "Scanned") {
                hasScanned = true
                if (RedisData.GetQrCode == 1) {
                    Bot.logger.mark(JSON.stringify(res))
                    if (typeof onScanned === "function") {
                        await onScanned()
                    }
                    await this.e.reply("二维码已扫描，请确认登录", true)
                    RedisData.GetQrCode++;
                }
            }
            if (res?.data?.status == "Confirmed") {
                confirmed = true
                Bot.logger.mark(JSON.stringify(res))
                break
            }
            // 100秒内仍未扫码则直接结束验证；已扫码则继续等待确认
            if (n >= 20 && !hasScanned) {
                break
            }
        }
        await utils.redisDel(this.e.user_id, 'GetQrCode')
        if (!confirmed) {
            await this.e.reply("验证超时", true)
            return false
        }
        if (!res?.data?.user_info || !Array.isArray(res?.data?.tokens) || res.data.tokens.length === 0) {
            await this.e.reply("stoken获取不完整请重新扫码", true)
            return false
        }
        const uid = res.data.user_info.aid || res.data.user_info.uid || res.data.user_info.account_id
        const mid = res.data.user_info.mid
        let token = (res.data.tokens.find(i => i.name === "stoken" || i.name === "stoken_v2") || res.data.tokens[0])?.token
         if (!(uid && token && mid)) {
            await this.e.reply("stoken获取不完整请重新扫码", true);
            return false
        }
        let UserData =  await this.user.getData("bbsGetCookie", {cookies:`stoken=${token}&uid=${uid}&mid=${mid}`},false)
        let stoken =`stoken=${token};stuid=${uid};mid=${mid}`
        return {
            cookie: `ltoken=${token};ltuid=${uid};cookie_token=${UserData.data?.cookie_token}`,
            stoken
        }
    }

    async UserPassMsg() {
        this.e.reply(this.sendMsgUserPassLogin)
        this.e.reply(`请将账号密码用逗号隔开私聊发送以完成绑定\n例：账号xxx@qq.com,密码xxxxx`)
    }
    async UserPassLogin() {
        let msg = this.e.msg.replace(/账号|密码|：|:/g, '').replace(/,|，/, ',').split(',');
        if (msg.length != 2) {
            return false;
        }
        let body = {
            account: msg[0], password: msg[1],
        }
        let res = await this.user.getData("loginByPassword", body, "")
        Bot.logger.mark(`[米哈游登录] ${Bot.logger.mark(JSON.stringify(res))}`)
        if (res.retcode == -3101) {
            Bot.logger.mark("[米哈游登录] 正在验证")
            this.aigis_captcha_data = JSON.parse(res.aigis_data.data)
            let vlData = await this.crack_geetest()
            // let validate = await this.user.getData("validate", this.aigis_captcha_data, false)
            if (vlData?.data?.geetest_seccode) {
                Bot.logger.mark("[米哈游登录] 验证成功")
            } else {
                Bot.logger.error("[米哈游登录] 验证失败")
                this.e.reply('接口效验失败，请重新尝试~')
                return false
            }
            let validate = vlData?.data?.geetest_seccode.replace("|jordan", '')
            let aigis = res.aigis_data.session_id + ";" + Buffer.from(JSON.stringify({
                geetest_challenge: vlData?.data?.geetest_challenge,
                geetest_seccode: validate + "|jordan",
                geetest_validate: validate
            })).toString("base64")
            body.headers = {
                'x-rpc-aigis': aigis,
            }
            res = await this.user.getData("loginByPassword", body, false)
            Bot.logger.mark(`[米哈游登录] ${Bot.logger.mark(JSON.stringify(res))}`)
        }
        if (res.retcode == 0) {
            let cookies = `stoken=${res.data.token.token}&mid=${res.data.user_info.mid}`
            let cookie_token = await this.user.getData("bbsGetCookie", { cookies })
            let ltoken = await this.user.getData('getLtoken', { cookies: `${cookies}` }, false)
            Bot.logger.mark(`[米哈游登录] ${Bot.logger.mark(JSON.stringify(cookie_token))}`)
            return {
                cookie: `ltoken=${ltoken?.data?.ltoken};ltuid=${res.data.user_info.aid};cookie_token=${cookie_token?.data?.cookie_token};`,
                stoken: `${cookies.replace('&', ';')};stuid=${res.data.user_info.aid};`
            }
        } else {
            await this.e.reply(`错误：${JSON.stringify(res)}`, true)
            return false
        }
    }
    async crack_geetest() {
        let res = ""; //await this.user.getData("microgg", this.aigis_captcha_data, false)
        // Bot.logger.mark(`[米哈游登录] ${Bot.logger.mark(JSON.stringify(res))}`)
        await this.e.reply(`请完成验证：https://challenge.minigg.cn/manual/index.html?gt=${this.aigis_captcha_data.gt}&challenge=${this.aigis_captcha_data.challenge}`, true)
        for (let n = 1; n < 60; n++) {
            await utils.sleepAsync(5000)
            try {
                res = await this.user.getData("microggVl", this.aigis_captcha_data, false)
                if (res?.data?.geetest_seccode) {
                    return res
                }
            } catch (err) {
                Bot.logger.error(`[米哈游登录] 错误：${Bot.logger.red(err)}`)
            }
        }
        await this.e.reply("验证超时", true)
        return false;
    }
}
