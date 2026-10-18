import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SyncStatus } from '../sync/outbox';
import { Txt } from './components';
import { useTheme } from './theme';

export function syncLabelKey(s: SyncStatus): { key: string; count?: number } {
  switch (s.kind) {
    case 'synced':
      return { key: 'sync.synced' };
    case 'sending':
      return { key: 'sync.sending' };
    case 'offline':
      return { key: 'sync.offline', count: s.queued };
    case 'queued':
      return { key: 'sync.queued', count: s.queued };
    case 'attention':
      return { key: 'sync.attention' };
  }
}

/** The small dot in the game header: synced / sending / offline with N queued / needs attention. */
export function SyncDot({ status }: { status: SyncStatus }) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const color =
    status.kind === 'synced'
      ? palette.signalGo
      : status.kind === 'attention'
        ? palette.signalStop
        : palette.signalWarn;
  const { key, count } = syncLabelKey(status);
  const label = t(key, { count });
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      {/* Colour is never the only signal: the text says the same. */}
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: color,
          borderWidth: 1,
          borderColor: palette.ink,
        }}
      />
      <Txt variant="small">{label}</Txt>
    </View>
  );
}
