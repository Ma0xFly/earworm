import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LlmFormErrors, LlmFormValues } from '@/lib/settings/options';
import { FeedbackMessage, type Feedback } from './FeedbackMessage';

type LlmSettingsCardProps = {
  values: LlmFormValues;
  errors: LlmFormErrors;
  disabled: boolean;
  testing: boolean;
  connectionFeedback: Feedback | null;
  onChange: (field: keyof LlmFormValues, value: string) => void;
  onTest: () => void;
};

/** LLM endpoint trio, API-key masking and the connection test row. */
export function LlmSettingsCard({
  values,
  errors,
  disabled,
  testing,
  connectionFeedback,
  onChange,
  onTest,
}: LlmSettingsCardProps) {
  const [showKey, setShowKey] = useState(false);

  const baseUrlDescribedBy = errors.baseUrl
    ? 'llm-base-url-help llm-base-url-error'
    : 'llm-base-url-help';
  const modelDescribedBy = errors.model ? 'llm-model-help llm-model-error' : 'llm-model-help';

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          LLM 连接
        </CardTitle>
        <CardDescription>
          OpenAI 兼容端点；默认连接本机 magpie 网关。修改为非本机地址时，保存会先申请该域名的访问权限。
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="llm-base-url">Base URL</Label>
          <Input
            id="llm-base-url"
            name="baseUrl"
            type="url"
            required
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={values.baseUrl}
            disabled={disabled}
            aria-invalid={Boolean(errors.baseUrl)}
            aria-describedby={baseUrlDescribedBy}
            onChange={(event) => onChange('baseUrl', event.target.value)}
          />
          <p id="llm-base-url-help" className="m-0 text-xs text-muted-foreground">
            默认 http://127.0.0.1:3425/v1。本机地址无需额外授权。
          </p>
          {errors.baseUrl ? (
            <p id="llm-base-url-error" className="m-0 text-sm text-destructive">
              {errors.baseUrl}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="llm-api-key">API Key</Label>
          <div className="flex items-start gap-2">
            <Input
              id="llm-api-key"
              name="apiKey"
              className="flex-1"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={values.apiKey}
              disabled={disabled}
              aria-describedby="llm-api-key-help"
              onChange={(event) => onChange('apiKey', event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="border-border"
              aria-pressed={showKey}
              aria-controls="llm-api-key"
              onClick={() => setShowKey((visible) => !visible)}
            >
              {showKey ? '隐藏 API Key' : '显示 API Key'}
            </Button>
          </div>
          <p id="llm-api-key-help" className="m-0 text-xs text-muted-foreground">
            仅保存在本机 chrome.storage.local；不会同步到其他设备，也不会写入日志或 URL。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="llm-model">模型</Label>
          <Input
            id="llm-model"
            name="model"
            required
            autoComplete="off"
            spellCheck={false}
            value={values.model}
            disabled={disabled}
            aria-invalid={Boolean(errors.model)}
            aria-describedby={modelDescribedBy}
            onChange={(event) => onChange('model', event.target.value)}
          />
          <p id="llm-model-help" className="m-0 text-xs text-muted-foreground">
            默认 group/free-ds。
          </p>
          {errors.model ? (
            <p id="llm-model-error" className="m-0 text-sm text-destructive">
              {errors.model}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || testing}
              onClick={onTest}
            >
              {testing ? '测试中…' : '测试连接'}
            </Button>
          </div>
          <FeedbackMessage feedback={connectionFeedback} className="max-w-xl" />
        </div>
      </CardContent>
    </Card>
  );
}
