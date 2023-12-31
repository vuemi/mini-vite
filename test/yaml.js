import YAML from 'yaml'
import fs from 'node:fs'

const file = fs.readFileSync('pnpm-lock.yaml', 'utf8')
const yaml = YAML.parse(file)
const packages = Object.keys(yaml.packages)

// /koa-convert@2.0.0
// /@vue/server-renderer@3.4.3(vue@3.4.3)
// @vue+server-renderer@3.4.3_vue@3.4.3
let str = packages.find(x => new RegExp(`/^@vue/server-renderer`).test(x))
console.log(str)
str = str.slice(1).split('/').join('+').slice(0, -1).replace('(', '_')
console.log(str)