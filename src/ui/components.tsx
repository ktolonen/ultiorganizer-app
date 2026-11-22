import { type ReactNode } from 'react';
import {
  type AccessibilityRole,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { FONTS, SIZE, SPACE, TARGET } from './tokens';

type Variant = 'body' | 'small' | 'title' | 'heading' | 'figure';

const VARIANTS: Record<Variant, TextStyle> = {
  body: { fontFamily: FONTS.text, fontSize: SIZE.sm },
  small: { fontFamily: FONTS.text, fontSize: SIZE.xs },
  heading: { fontFamily: FONTS.textBold, fontSize: SIZE.md },
  title: { fontFamily: FONTS.textBold, fontSize: SIZE.lg },
  figure: { fontFamily: FONTS.figures, fontSize: SIZE.xl, fontVariant: ['tabular-nums'] },
};

export function Txt({
  variant = 'body',
  muted,
  style,
  ...props
}: TextProps & { variant?: Variant; muted?: boolean }) {
  const { palette } = useTheme();
  return (
    <Text
      {...props}
      // Dynamic Type scales text, except the score and clocks (variant "figure").
      allowFontScaling={variant !== 'figure'}
      maxFontSizeMultiplier={2}
      style={[VARIANTS[variant], { color: muted ? palette.muted : palette.ink }, style]}
    />
  );
}

export function Screen({
  children,
  style,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.surface }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  hint,
  size = 'min',
  role = 'button',
  icon,
}: {
  label: string;
  onPress: () => void;
  /** Decorative, shown before the label; the label stays the accessible name. */
  icon?: ReactNode;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  hint?: string;
  size?: keyof typeof TARGET;
  role?: AccessibilityRole;
}) {
  const { palette } = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          height: TARGET[size],
          backgroundColor: primary ? palette.ink : palette.surface,
          borderColor: palette.ink,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon}
      {/* Fixed-height button: the label follows the system text size, then shrinks to fit. */}
      <Text
        allowFontScaling
        maxFontSizeMultiplier={2}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{
          flexShrink: 1,
          fontFamily: FONTS.textBold,
          fontSize: SIZE.md,
          color: primary ? palette.surface : palette.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A single-line text input sized and coloured like the buttons. */
export function TextField({ style, ...rest }: TextInputProps) {
  const { palette } = useTheme();
  return (
    <TextInput
      placeholderTextColor={palette.muted}
      {...rest}
      style={[
        styles.input,
        { borderColor: palette.ink, color: palette.ink },
        rest.editable === false && { opacity: 0.4 },
        style,
      ]}
    />
  );
}

export function Field({ children }: { children: ReactNode }) {
  return <View style={styles.field}>{children}</View>;
}

export function Divider() {
  const { palette } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.line }} />;
}

export const layout = StyleSheet.create({
  page: { flex: 1, padding: SPACE.lg, gap: SPACE.md },
  /** ScrollView content: flexGrow, since flex: 1 caps content at the viewport and blocks scrolling. */
  scroll: { flexGrow: 1, padding: SPACE.lg, gap: SPACE.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  input: {
    borderWidth: 2,
    borderRadius: 12,
    minHeight: TARGET.min,
    paddingHorizontal: SPACE.md,
    fontFamily: FONTS.text,
    fontSize: SIZE.sm,
  },
  button: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: SPACE.lg,
    flexDirection: 'row',
    gap: SPACE.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { gap: SPACE.xs },
});
