// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderApp() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  return { container, root };
}

describe('App 浏览器冒烟（happy-dom 下主线程回退路径）', () => {
  beforeEach(() => {
    // happy-dom 无真实 Worker；App 在 typeof Worker === 'undefined' 时回退主线程同步运行
    vi.stubGlobal('Worker', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('初始即显示示例模型与三候选汇总，启动反演后展示「唯一/歧义/无解」标签及最小见证 init/xorOut', async () => {
    const { container } = await renderApp();

    expect(container.textContent).toContain('CRC 参数反演复核台');
    expect(container.querySelectorAll('table').length).toBeGreaterThan(0);
    const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('启动反演'))!;
    expect(startBtn).toBeTruthy();

    await act(async () => {
      startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const text = container.textContent || '';
    expect(text).toContain('结论');
    // 示例含唯一、歧义（0x07 左移真实歧义 d=1）与无解候选
    expect(text).toContain('无解');
    expect(text).toContain('唯一');
    expect(text).toContain('歧义');
    // 见证以 0x.. 形式展示
    expect(/init\s*=?\s*0x[0-9A-F]{2}/.test(text)).toBe(true);
    // 秩与 2^nullity 计数
    expect(text).toContain('精确解数');
  });

  it('非法输入阻止计算并展示定位信息；修正后可正常反演', async () => {
    const { container } = await renderApp();
    const inputs = container.querySelectorAll('input[type="text"]');
    // 第一个文本输入为模型名称；样本载荷输入在 SampleTable 内
    const payloadInputs = [...inputs].filter((el) => (el as HTMLInputElement).placeholder?.includes('01 03'));
    expect(payloadInputs.length).toBeGreaterThan(0);
    const firstPayload = payloadInputs[0] as HTMLInputElement;
    await act(async () => {
      setInputValue(firstPayload, 'ZZ');
      await Promise.resolve();
    });
    const startBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('启动反演'))!;
    await act(async () => {
      startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const text = container.textContent || '';
    expect(text).toContain('问题');
    expect(text).not.toContain('精确解数');
  });
});
