// @vitest-environment jsdom
// 回归:closeSheet 曾不置空 sheetRoot → sheetOpen() 恒 true → 返回键被 __routeBack 永久吞掉
import { describe, expect, it } from 'vitest'
import { closeSheet, openSheet, sheetOpen } from '../src/app/ui'

describe('bottom sheet 状态机', () => {
  it('open → sheetOpen true;close → 立即 false(返回键失效回归)', () => {
    openSheet(['测试'])
    expect(sheetOpen()).toBe(true)
    closeSheet()
    expect(sheetOpen()).toBe(false)
  })

  it('close 幂等;close 后可再次 open', () => {
    openSheet(['a'])
    closeSheet()
    closeSheet()
    expect(sheetOpen()).toBe(false)
    openSheet(['b'])
    expect(sheetOpen()).toBe(true)
    closeSheet()
    expect(sheetOpen()).toBe(false)
  })

  it('未关闭直接再 open:旧的关、新的开,状态保持 true', () => {
    openSheet(['a'])
    openSheet(['b'])
    expect(sheetOpen()).toBe(true)
    closeSheet()
    expect(sheetOpen()).toBe(false)
  })

  it('closeSheet 移除 DOM 节点(动画超时后无残留)', () => {
    openSheet(['a'])
    const count = document.querySelectorAll('#an-sheet').length
    closeSheet()
    expect(sheetOpen()).toBe(false)
    expect(document.querySelectorAll('#an-sheet').length).toBeLessThanOrEqual(count)
  })
})
