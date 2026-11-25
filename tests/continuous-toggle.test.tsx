/**
 * Continuous playback toggle (spec §6 F3 / §8.2).
 *
 * The switch lives at the player's right edge inside the body-level shadow
 * root. These tests pin the public behaviour: it reflects the persisted
 * setting, writes the setting through the session seam, and does not forward
 * player clicks to the page.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import { SETTINGS_STORAGE_KEY, SettingsProvider } from '@/lib/settings';
import { ContinuousToggle } from '@/features/playback/ContinuousToggle';
import { readStorage, seedStorage } from './mocks/chrome';

const sessionMock = vi.hoisted(() => ({ setContinuous: vi.fn() }));

vi.mock('@/features/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/session')>();
  return {
    ...actual,
    useSession: () => ({
      ...actual.idleSessionApi,
      setContinuous: sessionMock.setContinuous,
    }),
  };
});

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

async function mount(onParentClick?: () => void): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <SettingsProvider>
        <div onClick={onParentClick}>
          <ContinuousToggle />
        </div>
      </SettingsProvider>,
    );
  });
  return container;
}

beforeEach(() => {
  sessionMock.setContinuous.mockReset();
  seedStorage(SETTINGS_STORAGE_KEY, {
    ...DEFAULT_SETTINGS,
    playback: { continuous: true },
  });
});

afterEach(() => {
  for (const instance of mounted.splice(0)) {
    act(() => instance.root.unmount());
    instance.container.remove();
  }
});

describe('continuous playback toggle', () => {
  it('reflects the persisted setting and writes both settings and the session seam', async () => {
    const container = await mount();
    const toggle = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-earworm-continuous-toggle]');
      expect(found).not.toBeNull();
      return found!;
    });

    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAccessibleName('连续播放');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect((readStorage(SETTINGS_STORAGE_KEY) as Settings).playback.continuous).toBe(false);
      expect(sessionMock.setContinuous).toHaveBeenCalledWith(false);
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('does not forward clicks to the player surface', async () => {
    const parentClick = vi.fn();
    const container = await mount(parentClick);
    const toggle = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-earworm-continuous-toggle]');
      expect(found).not.toBeNull();
      return found!;
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(parentClick).not.toHaveBeenCalled();
    expect(toggle.style.pointerEvents).toBe('auto');
  });
});
