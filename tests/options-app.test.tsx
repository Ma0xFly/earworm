import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@/lib/contracts';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings';
import { OptionsApp } from '@/features/options';
import { chromeMock, readStorage, seedStorage } from './mocks/chrome';

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderOptions() {
  render(<OptionsApp />);
  await screen.findByLabelText('Base URL');
}

describe('OptionsApp', () => {
  it('renders the default values when storage is empty', async () => {
    await renderOptions();

    expect(screen.getByRole('heading', { name: 'Earworm 设置' })).toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toHaveValue(DEFAULT_SETTINGS.llm.baseUrl);
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('模型')).toHaveValue(DEFAULT_SETTINGS.llm.model);

    expect(screen.getByRole('switch', { name: '模糊英文字幕' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: '模糊中文字幕' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: '连续播放' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('shows the finalized logo in the header with an accessible name', async () => {
    await renderOptions();

    expect(screen.getByRole('img', { name: 'Earworm' })).toHaveAttribute(
      'src',
      'chrome-extension://earworm-test/brand/earworm-logo-full.png',
    );
    expect(screen.getByRole('heading', { name: 'Earworm 设置' })).toBeInTheDocument();
  });

  it('repopulates every field from chrome.storage.local on load', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, {
      ...DEFAULT_SETTINGS,
      llm: {
        baseUrl: 'https://custom.example/v1',
        apiKey: 'sk-stored',
        model: 'stored-model',
      },
      blur: { en: true, zh: false },
      playback: { continuous: true },
    });

    await renderOptions();

    expect(screen.getByLabelText('Base URL')).toHaveValue('https://custom.example/v1');
    expect(screen.getByLabelText('API Key')).toHaveValue('sk-stored');
    expect(screen.getByLabelText('模型')).toHaveValue('stored-model');
    expect(screen.getByRole('switch', { name: '模糊英文字幕' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: '模糊中文字幕' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: '连续播放' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reveals and hides the API key without losing it', async () => {
    await renderOptions();
    const key = screen.getByLabelText('API Key');
    fireEvent.change(key, { target: { value: 'sk-secret' } });

    expect(key).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));

    expect(key).toHaveAttribute('type', 'text');
    expect(key).toHaveValue('sk-secret');
    expect(screen.getByRole('button', { name: '隐藏 API Key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '隐藏 API Key' }));
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveValue('sk-secret');
  });
});

function mockSendMessage(implementation: () => Promise<unknown>) {
  const sendMessage = vi.fn(implementation);
  chromeMock.runtime.sendMessage =
    sendMessage as unknown as typeof chromeMock.runtime.sendMessage;
  return sendMessage;
}

function mockPermissions(contains: boolean, request: boolean) {
  const containsSpy = vi
    .spyOn(chromeMock.permissions, 'contains')
    .mockResolvedValue(contains);
  const requestSpy = vi
    .spyOn(chromeMock.permissions, 'request')
    .mockResolvedValue(request);
  return { containsSpy, requestSpy };
}

describe('OptionsApp connection test', () => {
  it('sends the form LLM trio to the background and shows the truncated sample', async () => {
    await renderOptions();
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-form' } });

    const sample = 'x'.repeat(300);
    const sendMessage = mockSendMessage(async () => ({ ok: true, sample }));

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    expect(
      await screen.findByText(`连接成功。示例：${'x'.repeat(160)}…`),
    ).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'earworm:test-llm',
      llm: { ...DEFAULT_SETTINGS.llm, apiKey: 'sk-form' },
    });
  });

  it('shows the background error when the connection fails', async () => {
    await renderOptions();
    mockSendMessage(async () => ({ ok: false, error: '模型不存在' }));

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByText('连接失败：模型不存在')).toBeInTheDocument();
  });

  it('does not call the background when the endpoint is invalid', async () => {
    await renderOptions();
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'not a url' },
    });
    const sendMessage = mockSendMessage(async () => ({ ok: true }));

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByText(/请先修正 Base URL 与模型/)).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('OptionsApp save and permission flow', () => {
  it('saves the LLM trio, blur and continuous-play defaults to local storage', async () => {
    await renderOptions();
    const { requestSpy } = mockPermissions(true, false);

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1/' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: ' sk-save ' } });
    fireEvent.change(screen.getByLabelText('模型'), {
      target: { value: ' gpt-4o-mini ' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '模糊英文字幕' }));
    fireEvent.click(screen.getByRole('switch', { name: '连续播放' }));

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText('设置已保存')).toBeInTheDocument();
    expect(readStorage(SETTINGS_STORAGE_KEY)).toEqual({
      ...DEFAULT_SETTINGS,
      llm: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-save',
        model: 'gpt-4o-mini',
      },
      blur: { en: true, zh: false },
      playback: { continuous: true },
    });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('requests a missing custom origin in the save gesture before persisting', async () => {
    await renderOptions();
    const { containsSpy, requestSpy } = mockPermissions(false, true);

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText('设置已保存')).toBeInTheDocument();
    expect(containsSpy).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*'],
    });
    expect(requestSpy).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*'],
    });
    expect(readStorage(SETTINGS_STORAGE_KEY)).toMatchObject({
      llm: { baseUrl: 'https://api.example.com/v1' },
    });
  });

  it('does not save the URL when the user denies host permission', async () => {
    seedStorage(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
    await renderOptions();
    const { requestSpy } = mockPermissions(false, false);

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText(/未授予 .* 的访问权限，设置未保存/)).toBeInTheDocument();
    expect(requestSpy).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*'],
    });
    expect(readStorage(SETTINGS_STORAGE_KEY)).toEqual(DEFAULT_SETTINGS);
  });

  it('skips permission APIs for the local default endpoint', async () => {
    await renderOptions();
    const { containsSpy, requestSpy } = mockPermissions(false, false);

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText('设置已保存')).toBeInTheDocument();
    expect(containsSpy).not.toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(readStorage(SETTINGS_STORAGE_KEY)).toEqual(DEFAULT_SETTINGS);
  });

  it('validates the form instead of saving malformed values', async () => {
    await renderOptions();
    const { requestSpy } = mockPermissions(true, true);

    fireEvent.change(screen.getByLabelText('模型'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText('请先修正表单中的错误，再保存设置。')).toBeInTheDocument();
    expect(screen.getByText('请填写模型名称')).toBeInTheDocument();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(readStorage(SETTINGS_STORAGE_KEY)).toBeUndefined();
  });

  it('restores defaults in the form without writing storage on reset', async () => {
    await renderOptions();

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '模糊中文字幕' }));
    fireEvent.click(screen.getByRole('button', { name: '重置为默认值' }));

    expect(await screen.findByText(/已恢复默认值/)).toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toHaveValue(DEFAULT_SETTINGS.llm.baseUrl);
    expect(screen.getByRole('switch', { name: '模糊中文字幕' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(readStorage(SETTINGS_STORAGE_KEY)).toBeUndefined();
  });
});
