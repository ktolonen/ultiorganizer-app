import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { QR_OPTIONS } from '../config';
import { pairErrorKey, pairServer } from '../services/pairing';
import { getRepo } from '../store/sqlite';
import { saveAppToken } from '../store/secure';
import { Button, Field, layout, Screen, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';
import { FONTS, SIZE, SPACE, TARGET } from '../ui/tokens';

export default function Pair() {
  const { t } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const [root, setRoot] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const input = {
    borderWidth: 2,
    borderColor: palette.ink,
    borderRadius: 12,
    minHeight: TARGET.min,
    paddingHorizontal: SPACE.md,
    color: palette.ink,
    fontFamily: FONTS.text,
    fontSize: SIZE.sm,
  } as const;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await pairServer(
      { root, token },
      { repo: await getRepo(), saveToken: saveAppToken, qr: QR_OPTIONS },
    );
    setBusy(false);
    if (!result.ok) return setError(t(pairErrorKey(result.error)));
    router.replace('/');
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={layout.page} keyboardShouldPersistTaps="handled">
        <Txt variant="title" accessibilityRole="header">
          {t('pair.title')}
        </Txt>
        <Txt muted>{t('pair.intro')}</Txt>
        <Button label={t('pair.scan')} onPress={() => router.push('/scan')} />
        <Field>
          <Txt variant="heading">{t('pair.root')}</Txt>
          <TextInput
            style={input}
            value={root}
            onChangeText={setRoot}
            placeholder={t('pair.rootHint')}
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel={t('pair.root')}
          />
        </Field>
        <Field>
          <Txt variant="heading">{t('pair.token')}</Txt>
          <TextInput
            style={input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel={t('pair.token')}
          />
        </Field>
        <Txt variant="small" muted>
          {t('pair.warning')}
        </Txt>
        {error && (
          <Txt accessibilityRole="alert" style={{ color: palette.signalStop }}>
            {error}
          </Txt>
        )}
        <Button
          label={t('pair.save')}
          onPress={() => void submit()}
          disabled={busy || !root || !token}
        />
      </ScrollView>
    </Screen>
  );
}
