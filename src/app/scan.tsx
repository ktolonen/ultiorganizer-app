import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { QR_OPTIONS } from '../config';
import { classifyQr } from '../pairing/qr';
import { pairErrorKey, pairServer } from '../services/pairing';
import { usePendingLink } from '../services/pending';
import { getRepo } from '../store/sqlite';
import { saveAppToken } from '../store/secure';
import { Button, layout, Screen, Txt } from '../ui/components';
import { useTheme } from '../ui/theme';

type Notice = { message: string; pairRoot?: string };

export default function Scan() {
  const { t } = useTranslation();
  const router = useRouter();
  const { palette } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [notice, setNotice] = useState<Notice | null>(null);
  const handling = useRef(false);
  const setPending = usePendingLink((s) => s.set);

  const onScan = async (data: string) => {
    if (handling.current) return;
    handling.current = true;
    try {
      const code = classifyQr(data, QR_OPTIONS);
      if (code.kind === 'unknown') {
        setNotice({ message: t(`scan.error.${code.error}`) });
        return;
      }
      const repo = await getRepo();
      if (code.kind === 'setup') {
        // The setup QR is read only here, never through a system deep link.
        const r = await pairServer(code.value, { repo, saveToken: saveAppToken, qr: QR_OPTIONS });
        if (!r.ok) return setNotice({ message: t(pairErrorKey(r.error)) });
        router.replace('/');
        return;
      }
      const server = await repo.serverByRoot(code.value.root);
      if (!server) {
        setNotice({
          message: `${t('scan.pairFirst')}. ${t('scan.pairFirstBody', { root: code.value.root })}`,
          pairRoot: code.value.root,
        });
        return;
      }
      setPending({ serverId: server.id, linkToken: code.value.linkToken });
      router.replace('/games');
    } finally {
      // Keep the lock briefly so one QR code is not handled twice while it stays in view.
      setTimeout(() => (handling.current = false), 1500);
    }
  };

  if (!permission) return <Screen />;
  if (!permission.granted) {
    return (
      <Screen>
        <View style={layout.page}>
          <Txt>{t('scan.permission')}</Txt>
          <Button label={t('scan.allow')} onPress={() => void requestPermission()} />
          <Button label={t('common.back')} kind="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={layout.page}>
        <Txt variant="title" accessibilityRole="header">
          {t('scan.title')}
        </Txt>
        <Txt muted>{t('scan.hint')}</Txt>
        <View style={[styles.camera, { borderColor: palette.ink }]}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => void onScan(data)}
          />
        </View>
        {notice && (
          <Txt accessibilityRole="alert" style={{ color: palette.signalStop }}>
            {notice.message}
          </Txt>
        )}
        {notice?.pairRoot && <Button label={t('home.pair')} onPress={() => router.push('/pair')} />}
        <Button label={t('common.back')} kind="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, borderWidth: 2, borderRadius: 12, overflow: 'hidden' },
});
