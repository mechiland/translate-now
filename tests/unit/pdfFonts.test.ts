import { describe, expect, it } from 'vitest';
import { classifyFont } from '@/lib/pdf/fonts';

describe('classifyFont', () => {
  it.each([
    ['AECCXO+NimbusRomNo9L-Regu', 'serif', false],
    ['RCUMTF+NimbusRomNo9L-Medi', 'serif', true],
    ['Times-Roman', 'serif', false],
    ['TimesNewRomanPS-BoldMT', 'serif', true],
    ['LiberationSerif', 'serif', false],
    ['EKLTYB+CMR12', 'serif', false],
    ['CHHMIX+CMBX12', 'serif', true],
    ['Cambria', 'serif', false],
    ['Helvetica-Bold', 'sans', true],
    ['ArialMT', 'sans', false],
    ['Calibri-Light', 'sans', false],
    ['Microsoft Sans Serif', 'sans', false],
    ['NotoSansCJKsc-Regular', 'sans', false],
    ['XEXHSJ+SFTT1000', 'mono', false],
    ['Courier', 'mono', false],
    ['LiberationMono', 'mono', false],
    ['CMTT10', 'mono', false],
  ])('%s -> %s (bold: %s)', (name, family, bold) => {
    const info = classifyFont({ name });
    expect(info.family).toBe(family);
    expect(info.bold).toBe(bold);
  });

  it('tells math fonts from TeX text fonts', () => {
    expect(classifyFont({ name: 'LICAEO+CMMI10' }).math).toBe('symbol');
    expect(classifyFont({ name: 'NSOWGJ+CMSY10' }).math).toBe('symbol');
    expect(classifyFont({ name: 'THPNLT+CMEX9' }).math).toBe('symbol');
    expect(classifyFont({ name: 'QDTWCG+MSBM10' }).math).toBe('symbol');
    expect(classifyFont({ name: 'FUIULY+CMR10' })).toMatchObject({ math: 'upright', tex: true });
    expect(classifyFont({ name: 'AECCXO+NimbusRomNo9L-Regu' }).math).toBeUndefined();
    expect(classifyFont({ name: 'CMTT10' }).math).toBeUndefined();
  });

  it('falls back to pdf.js flags for unknown names', () => {
    expect(classifyFont({ name: 'F1', isSerifFont: true }).family).toBe('serif');
    expect(classifyFont({ name: 'F1', isMonospace: true }).family).toBe('mono');
    expect(classifyFont({ name: 'F1', bold: true }).bold).toBe(true);
    expect(classifyFont(null).family).toBe('sans');
  });
});
