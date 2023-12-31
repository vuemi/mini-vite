import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import Koa from 'koa'
import YAML from 'yaml'
import compilerSFC from '@vue/compiler-sfc'

const root = process.cwd()
const p = (...args) => path.join(root, ...args)

const PNPM_PACKAGES = (() => {
    const filePath = p('pnpm-lock.yaml')
    if (fs.existsSync(filePath)) {
        const yaml = YAML.parse(fs.readFileSync(filePath, 'utf8'))
        return Object.keys(yaml.packages)
    }
    return
})()

const streamToString = (stream, encoding = 'utf8') => {
    return new Promise((resolve, reject) => {
        const chunks = []
        stream.on('data', (chunk) => chunks.push(chunk))
        stream.on('end', () =>
            resolve(Buffer.concat(chunks).toString(encoding))
        )
        stream.on('error', reject)
    })
}
const stringToStream = (text) => {
    const stream = new Readable()
    stream.push(text)
    stream.push(null)
    return stream
}

const app = new Koa()

// 3. 加载第三方模块
app.use(async (ctx, next) => {
    if (ctx.path.startsWith('/@modules/')) {
        let moduleName = ctx.path.substring(10)

        // 处理 pnpm 项目
        if (PNPM_PACKAGES) {
            const re = new RegExp(`^/${moduleName}`)
            const packageName = PNPM_PACKAGES
                .find((name) => re.test(name))
                .slice(1)
                .split('/')
                .join('+')
                .replace('(', '_')
                .replace(')', '')
            // console.log(packageName, moduleName)
            moduleName = path.join('.pnpm', packageName, 'node_modules', moduleName)
        }

        const pkgPath = p('node_modules', moduleName, 'package.json')
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        ctx.path = `/node_modules/${moduleName}/${pkg.module}`
    }
    await next()
})

// 1. 静态文件服务器
// 直接使用 koa-send 或 koa-static 也可以
app.use(async (ctx, next) => {
    const urlPath = ctx.path === '/' ? 'index.html' : ctx.path

    let filePath = null
    const staticDir = ['.', 'public']
    for (const dir of staticDir) {
        const f = p(dir, urlPath)
        if (fs.existsSync(f)) {
            filePath = f
            break
        }
    }
    if (!filePath) {
        ctx.status = 404
        return
    }

    ctx.type = path.extname(urlPath)
    ctx.body = fs.createReadStream(filePath)
    await next() // 调用下一个中间件
})

// 4. 处理单文件组件
app.use(async (ctx, next) => {
    if (ctx.path.endsWith('.vue')) {
        const content = await streamToString(ctx.body)
        const { descriptor } = compilerSFC.parse(content)

        let code
        if (!ctx.query.type) {
            code = descriptor.script.content
            code = code.replace(/export\s+default\s+/g, 'const __script = ')
            code +=
                `import { render as __render } from "${ctx.path}?type=template"\n` +
                `import "${ctx.path}?type=style"\n` +
                `__script.render = __render\n` +
                `export default __script`
            ctx.type = 'js'
        } else if (ctx.query.type === 'template') {
            const templateRender = compilerSFC.compileTemplate({
                source: descriptor.template.content,
                id: ctx.path
            })
            code = templateRender.code
            ctx.type = 'js'
        } else if (ctx.query.type === 'style') {
            code = descriptor.styles.map((style) => style.content).join('')
            ctx.type = 'css'
        }
        ctx.body = code
    }
    await next()
})

// 2. 修改第三方模块的路径
// 最新版本的 vite 会在服务启动前将模块路径预处理好
// 该项目是简化版的实现方式
app.use(async (ctx, next) => {
    // 此处不可通过 ctx.path.endsWith('.js') 判断，
    // 因为 App.vue?type=template 请求也会被解析为 js，
    // 而且也要修改第三方模块的路径。
    if (ctx.type === 'application/javascript') {
        const content = typeof ctx.body === 'string'
            ? ctx.body
            : await streamToString(ctx.body)
        // import Vue from 'vue'
        // 替换为 import Vue from '/@modules/vue'
        // import App from './App.vue' 不做处理
        ctx.body = content
            .replace(/(from\s+['"])(?![\.\/])/g, '$1/@modules/')
            .replace(/process\.env\.NODE_ENV/g, '"development"')
    }
    await next()
})

// 5. 处理 CSS 文件导入和组件内样式
app.use(async (ctx, next) => {
    if (ctx.type === 'text/css') {
        let content = typeof ctx.body === 'string'
            ? ctx.body
            : await streamToString(ctx.body)
        content =
            `const css = "${content.replace(/\n/g, '')}"\n` +
            `const styleEl = document.createElement('style')\n` +
            `styleEl.setAttribute('type', 'text/css')\n` +
            `styleEl.innerHTML = css\n` +
            `document.head.appendChild(styleEl)\n` +
            `export default css`
        ctx.type = 'js'
        ctx.body = content
    }
    await next()
})

// 6. 处理图片文件导入
app.use(async (ctx) => {
    if (ctx.type.includes('image/') && ctx.path.includes('/src')) {
        const imageType = ctx.type
        const content = await streamToString(ctx.body, 'base64')
        ctx.type = 'js'
        ctx.body = `export default "data:${imageType};base64,${content}"`
    }
})

app.listen(2333, () => {
    console.log('App running at http://localhost:2333')
})
