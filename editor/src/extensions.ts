import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from 'tiptap-markdown'

/** 笔记编辑器统一扩展集(桌面与 Android 共用;P1:文本+待办)。 */
export function createNoteExtensions(): Editor['options']['extensions'] {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      codeBlock: false, // P1 不放代码块(移动端体验差),行内代码保留
      // Link mark(StarterKit v3 内置):必须启用,否则桌面同步来的 [text](url)
      // 解析时降级为纯文本,手机端一保存链接语法即丢(数据保真)。
      // 关闭自动识别/点击跳转/粘贴转链,仅保留显式语法
      link: { autolink: false, openOnClick: false, linkOnPaste: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: '开始记录…' }),
    Markdown.configure({ html: false, linkify: false, breaks: false }),
  ]
}

/** 从编辑器读出 Markdown 正文。 */
export function editorToMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as Record<
    string,
    { getMarkdown?: () => string } | undefined
  >
  return storage['markdown']?.getMarkdown?.() ?? editor.getHTML()
}
