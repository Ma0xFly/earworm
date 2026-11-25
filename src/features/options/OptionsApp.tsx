import './options.css';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DEFAULT_SETTINGS } from '@/lib/contracts';
import { sendRuntimeMessage, type TestLlmResponse } from '@/lib/messages';
import { loadSettings, saveSettings } from '@/lib/settings';
import {
  draftFromSettings,
  draftToPatch,
  ensureBaseUrlPermission,
  normalizeLlmForm,
  truncateSample,
  validateLlmForm,
  type LlmFormErrors,
  type LlmFormValues,
  type OptionsDraft,
} from '@/lib/settings/options';
import { DefaultsCard } from './DefaultsCard';
import { FeedbackMessage, type Feedback } from './FeedbackMessage';
import { LlmSettingsCard } from './LlmSettingsCard';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTestResponse(value: unknown): value is TestLlmResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * Options page: LLM endpoint trio + connection test, and the default blur and
 * playback states. The API key stays in `chrome.storage.local` via
 * `saveSettings`; a custom endpoint gets an optional host-permission request
 * in the same click that saves it.
 */
export function OptionsApp() {
  const [draft, setDraft] = useState<OptionsDraft>(() => draftFromSettings(DEFAULT_SETTINGS));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [errors, setErrors] = useState<LlmFormErrors>({});
  const [connectionFeedback, setConnectionFeedback] = useState<Feedback | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let active = true;
    void loadSettings()
      .then((settings) => {
        if (!active) return;
        setDraft(draftFromSettings(settings));
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateLlm = (field: keyof LlmFormValues, value: string) => {
    setDraft((previous) => ({
      ...previous,
      llm: { ...previous.llm, [field]: value },
    }));
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
    setSaveFeedback(null);
  };

  const updateBlur = (lang: 'en' | 'zh', checked: boolean) => {
    setDraft((previous) => ({
      ...previous,
      blur: { ...previous.blur, [lang]: checked },
    }));
    setSaveFeedback(null);
  };

  const updateContinuous = (checked: boolean) => {
    setDraft((previous) => ({ ...previous, continuous: checked }));
    setSaveFeedback(null);
  };

  const handleTest = async () => {
    if (testing) return;

    const nextErrors = validateLlmForm(draft.llm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setConnectionFeedback({ kind: 'error', text: '请先修正 Base URL 与模型，再测试连接。' });
      return;
    }

    setTesting(true);
    setConnectionFeedback(null);
    try {
      const llm = normalizeLlmForm(draft.llm);
      const response: unknown = await sendRuntimeMessage<TestLlmResponse>({
        type: 'earworm:test-llm',
        llm,
      });

      if (!isTestResponse(response)) {
        setConnectionFeedback({
          kind: 'error',
          text: '连接失败：后台没有返回测试结果。',
        });
        return;
      }

      if (response.ok) {
        const sample = truncateSample(response.sample);
        setConnectionFeedback({
          kind: 'success',
          text: sample ? `连接成功。示例：${sample}` : '连接成功。',
        });
        return;
      }

      setConnectionFeedback({
        kind: 'error',
        text: `连接失败：${response.error ?? '未知错误'}`,
      });
    } catch (error) {
      setConnectionFeedback({ kind: 'error', text: `连接失败：${errorText(error)}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;

    const nextErrors = validateLlmForm(draft.llm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveFeedback({ kind: 'error', text: '请先修正表单中的错误，再保存设置。' });
      return;
    }

    setSaving(true);
    setSaveFeedback(null);
    try {
      // Keep the permission prompt and the storage write in the save gesture.
      const permission = await ensureBaseUrlPermission(draft.llm.baseUrl);
      if (!permission.granted) {
        setSaveFeedback({ kind: 'error', text: permission.error });
        return;
      }

      const saved = await saveSettings(draftToPatch(draft));
      setDraft(draftFromSettings(saved));
      setErrors({});
      setSaveFeedback({ kind: 'success', text: '设置已保存' });
    } catch (error) {
      setSaveFeedback({ kind: 'error', text: `保存失败：${errorText(error)}` });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(draftFromSettings(DEFAULT_SETTINGS));
    setErrors({});
    setConnectionFeedback(null);
    setSaveFeedback({
      kind: 'info',
      text: '已恢复默认值，点击“保存设置”后生效。',
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  return (
    <main className="earworm-options min-h-screen bg-muted/30 py-12">
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-12 sm:px-6"
        aria-labelledby="options-title"
        noValidate
        onSubmit={onSubmit}
      >
        <header className="flex flex-col gap-3 pb-2">
          <img
            src={chrome.runtime.getURL('brand/earworm-logo-full.png')}
            alt="Earworm"
            className="h-auto w-28"
          />
          <h1 id="options-title" className="m-0 text-2xl font-semibold tracking-tight">
            Earworm 设置
          </h1>
          <p className="m-0 text-sm text-muted-foreground">
            配置 LLM 连接、字幕模糊与连续播放的默认状态。所有设置只保存在本机。
          </p>
        </header>

        {!loaded ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            正在加载设置…
          </p>
        ) : (
          <>
            <LlmSettingsCard
              values={draft.llm}
              errors={errors}
              disabled={saving}
              testing={testing}
              connectionFeedback={connectionFeedback}
              onChange={updateLlm}
              onTest={() => void handleTest()}
            />

            <DefaultsCard
              blur={draft.blur}
              continuous={draft.continuous}
              disabled={saving}
              onBlurChange={updateBlur}
              onContinuousChange={updateContinuous}
            />

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存设置'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-border"
                disabled={saving}
                onClick={handleReset}
              >
                重置为默认值
              </Button>
            </div>

            <FeedbackMessage feedback={saveFeedback} />
          </>
        )}
      </form>
    </main>
  );
}
