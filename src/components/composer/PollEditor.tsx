// src/components/composer/PollEditor.tsx
'use client';

import { useTranslations } from 'next-intl';
import { BarChart3, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  POLL_DURATIONS_MINUTES,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  validatePoll,
  type PollInput,
} from '@/lib/poll';

interface PollEditorProps {
  value: PollInput;
  onChange: (value: PollInput) => void;
  onRemove: () => void;
  disabled?: boolean;
}

/** "1 hora", "6 horas", "1 dia", "3 dias", "7 dias". */
const durationKey = (minutes: number) => (minutes % 1440 === 0 ? 'days' : 'hours');

/** Criação da enquete no compositor: de 2 a 4 opções (até 25 caracteres) e o prazo. Sem mídia junto, como nas outras redes. */
export default function PollEditor({ value, onChange, onRemove, disabled }: PollEditorProps) {
  const t = useTranslations('Composer');
  const filled = value.options.map((o) => o.trim()).filter(Boolean).length;
  const error = validatePoll(value);
  const errorText = filled >= POLL_MIN_OPTIONS && error ? t(`pollError_${error}`) : null;

  const setOption = (index: number, text: string) => {
    const options = value.options.slice();
    options[index] = text;
    onChange({ ...value, options });
  };
  const addOption = () => onChange({ ...value, options: [...value.options, ''] });
  const removeOption = (index: number) => onChange({ ...value, options: value.options.filter((_, i) => i !== index) });

  return (
    <section className="rounded-lg border p-3" aria-label={t('pollTitle')} data-testid="composer-poll">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />{t('pollTitle')}</h3>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} aria-label={t('pollRemove')} title={t('pollRemove')} disabled={disabled} data-testid="composer-poll-remove">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="space-y-2">
        {value.options.map((text, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                value={text}
                onChange={(event) => setOption(index, event.target.value)}
                placeholder={t('pollOptionPlaceholder', { number: index + 1 })}
                aria-label={t('pollOptionPlaceholder', { number: index + 1 })}
                maxLength={POLL_OPTION_MAX_LENGTH + 10 /* deixa passar para o aviso aparecer; o servidor recusa acima de 25 */}
                disabled={disabled}
                className="pr-12"
                data-testid={`composer-poll-option-${index}`}
              />
              <span className={[...text].length > POLL_OPTION_MAX_LENGTH ? 'absolute right-3 top-1/2 -translate-y-1/2 text-xs text-destructive' : 'absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground'}>
                {[...text].length}/{POLL_OPTION_MAX_LENGTH}
              </span>
            </div>
            {index >= POLL_MIN_OPTIONS && (
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeOption(index)} aria-label={t('pollOptionRemove', { number: index + 1 })} disabled={disabled}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {value.options.length < POLL_MAX_OPTIONS && (
          <Button type="button" variant="ghost" size="sm" className="text-primary" onClick={addOption} disabled={disabled} data-testid="composer-poll-add">
            <Plus className="mr-1 h-4 w-4" />{t('pollAddOption')}
          </Button>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
        <label className="text-sm text-muted-foreground" htmlFor="composer-poll-duration">{t('pollDuration')}</label>
        <Select value={String(value.durationMinutes)} onValueChange={(minutes) => onChange({ ...value, durationMinutes: Number(minutes) })} disabled={disabled}>
          <SelectTrigger id="composer-poll-duration" className="w-40" data-testid="composer-poll-duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLL_DURATIONS_MINUTES.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {t(`pollDuration_${durationKey(minutes)}`, { count: durationKey(minutes) === 'days' ? minutes / 1440 : minutes / 60 })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {errorText && <p className="mt-2 text-sm text-destructive" role="alert">{errorText}</p>}
    </section>
  );
}
