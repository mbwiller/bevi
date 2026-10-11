import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, type, useTheme } from '@/theme';

type Block =
  | { kind: 'h1' | 'h2' | 'p'; text: string }
  | { kind: 'list'; items: string[] };

/**
 * Parses the small markdown subset the privacy note uses: `#` and `##` headings, `-` bullet lists,
 * paragraphs separated by blank lines, and `**bold**` inline. Anything else renders as plain text.
 */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of src.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => /^[-*] /.test(l))) {
      blocks.push({ kind: 'list', items: lines.map((l) => l.slice(2)) });
    } else if (lines.length === 1 && lines[0]!.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: lines[0]!.slice(3) });
    } else if (lines.length === 1 && lines[0]!.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: lines[0]!.slice(2) });
    } else {
      blocks.push({ kind: 'p', text: lines.join(' ') });
    }
  }
  return blocks;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Text key={i} style={styles.bold}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Renders `parseMarkdown` blocks as plain paragraphs, headings and bullets. No dependency. */
export function Markdown({ source }: { source: string }) {
  const { colors } = useTheme();
  const text = { color: colors.text };
  return (
    <View style={styles.doc}>
      {parseMarkdown(source).map((b, i) => {
        if (b.kind === 'h1') {
          return (
            <Text key={i} style={[type.screenTitle, text]} role="heading" aria-level={1}>
              <Inline text={b.text} />
            </Text>
          );
        }
        if (b.kind === 'h2') {
          return (
            <Text key={i} style={[type.heading, styles.h2, text]} role="heading" aria-level={2}>
              <Inline text={b.text} />
            </Text>
          );
        }
        if (b.kind === 'list') {
          return (
            <View key={i} style={styles.list}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.item}>
                  <Text style={[type.bodyLarge, { color: colors.textSecondary }]} aria-hidden>
                    •
                  </Text>
                  <Text style={[type.bodyLarge, styles.itemText, text]}>
                    <Inline text={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={[type.bodyLarge, text]}>
            <Inline text={b.text} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  doc: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
  h2: { marginTop: spacing.sm },
  bold: { fontWeight: '700' },
  list: { gap: spacing.xs },
  item: { flexDirection: 'row', gap: spacing.sm },
  itemText: { flex: 1, minWidth: 0 },
});
