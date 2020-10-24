const fs = require('fs')
const path = require('path')
const decamelize = require('decamelize')

console.log(`[init] reading config.json...`)

/* Default configuration (its not ok to change here!, use config.json.)
 */

const DEFAULTS = {
  // default pairs we track
  pairs: ['BTCUSD'],

  // mapping can be useful if you track btcusdt but save it as BTCUSD
  // respectively mappedPair => stringified regex query
  mapping: {
    /* 
      // example:
      "BTCUSD": "(?:XBT|BTC)-?USDT?-?(?:PERPETUAL)",
      "ETHUSD": "ETH-?USDT?-?(?:PERPETUAL)"
    */
  },

  // will connect to exchanges and subscribe to pairs on startup
  collect: true,

  // default server port
  port: 3000,

  // dont broadcast below ms interval
  delay: 0,

  // aggregate trades that came within same millisecond before broadcast
  // (note) saving to storage is NOT impacted
  // (warning) will add +50ms delay for confirmation that trade actually came on same ms
  aggr: true,

  // allow remote pair fallback if it matchs
  fixLocalPair: true,

  // restrict origin (now using regex)
  origin: '.*',

  // max n of bars a user can get in 1 call
  maxFetchLength: 100000,

  // admin access type (whitelist, all, none)
  admin: 'whitelist',

  // enable websocket server (if you only use this for storing trade data set to false)
  websocket: true,

  // enable api (historical/{from: timestamp}/{to: timestamp})
  api: true,

  // storage solution, either
  // false | null (no storage, everything is wiped out after broadcast)
  // "files" (periodical text file),
  // "influx" (timeserie database),

  // NB: use array or comma separated storage names for multiple storage solution
  // default = "files" just store in text files, no further installation required.
  storage: 'files',

  // store interval (in ms)
  backupInterval: 1000 * 10,

  // influx db server to use when storage is set to "influx"
  influxUrl: 'localhost:8086',

  // influx database
  influxDatabase: 'significant_trades',

  // base name measurement used to store the bars
  // if influxMeasurement is "trades" and influxTimeframe is "10000", influx will save to trades_10s
  influxMeasurement: 'trades',

  // timeframe in ms (default 10s === 10000ms)
  // this is lowest timeframe that influx will use to group the trades
  influxTimeframe: 10000,

  // downsampling
  influxResampleTo: [1000 * 30, 1000 * 60, 1000 * 60 * 5, 1000 * 60 * 15, 1000 * 60 * 21, 1000 * 60 * 60, 1000 * 60 * 60 * 4, 1000 * 60 * 60 * 8, 1000 * 60 * 60 * 24],

  // create new text file every N ms when storage is set to "file" (default 1h)
  filesInterval: 3600000,

  // default place to store the trades data files
  filesLocation: './data',

  // reconnect exchange api if no data received since n ms (default 10m)
  reconnectionThreshold: 1000 * 60 * 5,

  // choose whether or not enable rate limiting on the provided api
  enableRateLimit: false,

  // rate limit time window (default 15m)
  rateLimitTimeWindow: 1000 * 60 * 15,

  // rate limit max request per rateLimitTimeWindow (default 30)
  rateLimitMax: 30,
}

/* Load custom server configuration
 */

let config

try {
  const configPath = path.resolve(__dirname, '../config.json')
  const configExamplePath = path.resolve(__dirname, '../config.json.example')
  if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
    fs.copyFileSync(configExamplePath, configPath)
  }

  config = require(configPath)
} catch (error) {
  throw new Error(`Unable to parse configuration file\n\n${error.message}`)
}

/* Merge default
 */

config = Object.assign(DEFAULTS, config)

/* Override config with ENV variables using decamelize + uppercase 
  (e.g. influxPreheatRange -> INFLUX_PREHEAT_RANGE)
 */

Object.keys(config).forEach(k => {
  config_to_env_key = decamelize(k, "_").toUpperCase()
  config_env_value = process.env[config_to_env_key]
  if (config_env_value) {
    config[k] = config_env_value
    console.log(`overriding '${k}' to '${config_env_value}' via env '${config_to_env_key}'`)
  }
})

/* Node arg based configuration
 */

if (process.argv.length > 2) {
  let exchanges = []
  process.argv.slice(2).forEach((arg) => {
    const keyvalue = arg.split('=')

    if (keyvalue.length === 1) {
      exchanges.push(arg)
    } else {
      try {
        config[keyvalue[0]] = JSON.parse(keyvalue[1])
      } catch (error) {
        config[keyvalue[0]] = keyvalue[1]
      }
    }
  })

  if (exchanges.length) {
    config.exchanges = exchanges
  }
}

/* Validate storage
 */

if (config.storage) {
  if (!Array.isArray(config.storage)) {
    if (config.storage.indexOf(',') !== -1) {
      config.storage = config.storage.split(',').map((a) => a.trim())
    } else {
      config.storage = [config.storage.trim()]
    }
  }

  for (let storage of config.storage) {
    const storagePath = path.resolve(__dirname, 'storage/' + storage + '.js')
    if (!fs.existsSync(storagePath)) {
      throw new Error(`Unknown storage solution "${storagePath}"`)
    }
  }
} else {
  config.storage = null
}

/* Others validations
 */

if (config.pair) {
  config.pairs = Array.isArray(config.pair) ? config.pair : config.pair.split(',')
  delete config.pair
}

if (!Array.isArray(config.pairs)) {
  if (config.pairs) {
    config.pairs = config.pairs
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length)
  } else {
    config.pairs = []
  }
}

if (!config.pairs.length) {
  config.pairs = ['BTCUSD']
}

for (let localPair in config.mapping) {
  if (typeof config.mapping[localPair] === 'string') {
    config.mapping[localPair] = new RegExp(config.mapping[localPair], 'i')
  }
}

if (config.exchanges && typeof config.exchanges === 'string') {
  config.exchanges = config.exchanges
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length)
}

if (!config.api && config.websocket) {
  console.warn(
    `[warning!] websocket is enabled but api is set to ${config.api}\n\t(ws server require an http server for the initial upgrade handshake)`
  )
}

if (!config.storage && config.collect) {
  console.warn(
    `[warning!] server will not persist any of the data it is receiving`
  )
}

if (!config.collect && !config.api) {
  console.warn(`[warning!] server has no purpose`)
}

if (!config.storage && !config.collect && (config.websocket || config.api)) {
  console.warn(
    `[warning!] ${
      config.websocket && config.api
        ? 'ws and api are'
        : config.websocket
        ? 'ws is'
        : 'api is'
    } enabled but neither storage or collect is enabled (may be useless)`
  )
}

if (config.websocket && !config.collect) {
  console.warn(
    `[warning!] collect is disabled but websocket is set to ${config.websocket} (may be useless)`
  )
}

if (!config.debug) {
  console.debug = function () {}
}

module.exports = config