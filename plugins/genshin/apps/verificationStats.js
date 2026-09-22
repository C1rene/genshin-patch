import plugin from '../../../lib/plugins/plugin.js'
import VerificationStats from '../model/VerificationStats.js'

export class verificationStats extends plugin {
  constructor() {
    super({
      name: 'genshin·过码统计',
      dsc: '查看验证码触发与通过次数',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#过码次数$',
          fnc: 'getVerificationCount'
        },
        {
          reg: '^#过码统计$',
          fnc: 'getVerificationStats'
        }
      ]
    })
  }

  async getVerificationCount() {
    const data = VerificationStats.getStats()
    await this.reply([
      '【验证码总次数】',
      `总触发次数：${data.triggered}`,
      `总通过次数：${data.passed}`
    ].join('\n'))
    return true
  }

  async getVerificationStats() {
    const data = VerificationStats.getStats()
    const entries = Object.entries(data.users || {})
      .sort((a, b) => (b[1].triggered - a[1].triggered) || (b[1].passed - a[1].passed) || a[0].localeCompare(b[0]))
    const groupEntries = Object.entries(data.groups || {})
      .sort((a, b) => (b[1].triggered - a[1].triggered) || (b[1].passed - a[1].passed) || a[0].localeCompare(b[0]))

    const lines = [
      '【验证码统计】',
      `总触发次数：${data.triggered}`,
      `总通过次数：${data.passed}`
    ]

    if (entries.length > 0) {
      lines.push('', '【QQ统计】')
      let userTriggered = 0
      let userPassed = 0

      for (const [qq, item] of entries) {
        userTriggered += item.triggered || 0
        userPassed += item.passed || 0
        const nickname = item.nickname || VerificationStats.resolveNickname(qq, this.e)
        const label = nickname ? `${nickname}（${qq}）` : qq
        lines.push(`${label}：触发 ${item.triggered || 0} | 通过 ${item.passed || 0}`)
      }

      const unknownTriggered = Math.max(0, data.triggered - userTriggered)
      const unknownPassed = Math.max(0, data.passed - userPassed)
      if (unknownTriggered > 0 || unknownPassed > 0)
        lines.push(`未归属/历史记录：触发 ${unknownTriggered} | 通过 ${unknownPassed}`)
    } else if (data.triggered > 0 || data.passed > 0) {
      lines.push('', `未归属/历史记录：触发 ${data.triggered} | 通过 ${data.passed}`)
    }

    if (groupEntries.length > 0) {
      lines.push('', '【群聊统计】')
      for (const [groupId, item] of groupEntries) {
        const groupName = item.name || VerificationStats.resolveGroupName(groupId, this.e)
        const label = groupName ? `${groupName}（${groupId}）` : groupId
        lines.push(`${label}：触发 ${item.triggered || 0} | 通过 ${item.passed || 0}`)
      }
    }

    await this.reply(lines.join('\n'))
    return true
  }
}
