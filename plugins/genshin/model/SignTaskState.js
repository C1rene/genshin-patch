const running = {
    game: 0,
    coin: 0
}

function queue(type) {
    return type === 'coin' ? 'coin' : 'game'
}

export function begin(type = 'game') {
    let key = queue(type)
    running[key]++
}

export function end(type = 'game') {
    let key = queue(type)
    running[key] = Math.max(0, running[key] - 1)
}

export function isRunning(type = 'game') {
    return running[queue(type)] > 0
}

export default {
    begin,
    end,
    isRunning
}
