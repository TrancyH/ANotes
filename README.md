# ANotes — 手机端笔记 App

与 ALink(桌面互联工程)配对的手机端笔记应用。仓库根下 `ALink/` 与 `ANotes/` 平级:
本工程**完全独立**——不属于 ALink 的 pnpm workspace,可单独构建、单独演进,互不影响。

## 目录结构

```text
ANotes/
├── android/     # Android 工程(Kotlin WebView 壳:FileObserver + JS Bridge,零外部依赖)
│   └── app/src/main/assets/editor/   # 编辑器离线 bundle(editor.js / editor.css,由 editor/ 构建产出)
└── editor/      # 编辑器 bundle 源码(独立 npm 包,无 React,Tiptap v3 IIFE)
    ├── src/android-main.ts           # WebView 入口:window.AmooNotes 桥(mount/loadNote/serialize/exec…)
    ├── src/{types,frontmatter,extensions}.ts  # 共享内核(与 AmooLink packages/notes-editor 保持一致)
    └── vite.config.ts                # 构建产物直落 ../android/app/src/main/assets/editor/
```

## 构建流程

```sh
# 1. 编辑器 bundle(改 editor/ 源码后执行;产物落 android assets)
cd editor
pnpm install
pnpm build          # 亦可 pnpm typecheck / pnpm test

# 2. Android APK(AGP 8.13 + Gradle 8.14 + Kotlin 2.2.20,阿里云镜像,自带 wrapper)
cd ../android
./gradlew assembleDebug
# 产物:app/build/outputs/apk/debug/app-debug.apk

# 3.(可选)同步给桌面端分发:ALink 打包时以 resources/android/AmooNotes.apk 分发,
#    重构建后记得 cp 一份保持两处一致:
#    cp app/build/outputs/apk/debug/app-debug.apk ../ALink/apps/desktop/resources/android/AmooNotes.apk
```

桌面端开发态(unpackaged)安装入口直接指向 `ANotes/android/app/build/outputs/apk/debug/app-debug.apk`
(相对 ALink/apps/desktop 上探三级到仓库根),所以本工程重新出包后桌面「安装笔记 App」即可拿到最新版。

## 与桌面的同步协议(契约,勿破坏)

- 笔记目录:手机 `/sdcard/Android/data/com.amoolink.notes/files/notes/`,桌面 `userData/notes/`;每条笔记一个 `.md`。
- `.md` = YAML frontmatter 子集(`id/title/createdAt/updatedAt/pinned`)+ Markdown 正文;序列化逻辑在
  `editor/src/frontmatter.ts`,与桌面 `ALink/packages/notes-editor/src/frontmatter.ts` 是**同一份内核的两份副本**——
  修改任一侧的文件格式/字段语义时必须同步另一侧(单测两侧都有,作为一致性护栏)。
- 同步策略(桌面 `ALink/apps/desktop/src/main/services/note-service.ts` 主导):manifest 三方比对(base/local/remote md5)、tombstone 删除、
  冲突生成双副本(副本标题带 `-冲突-yyyyMMdd-HHmm`),5s 轮询 + autoSync 开关。

## 设计文档

- [docs/01-功能设计与UI规范.md](docs/01-功能设计与UI规范.md) — 功能重设计总纲:厂商对标矩阵、全 Web UI 化架构、frontmatter v2 与同步协议扩展、UI 设计规范(对齐 ALink 令牌)、P2 媒体附件方案、里程碑与验收(设计稿,未实施)
- 早期设计见 `../ALink/docs/08-笔记模块设计(M6).md`(M6 选型、数据模型与验收记录)
