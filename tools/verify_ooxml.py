# -*- coding: utf-8 -*-
"""
OOXML 产物校验器（独立实现）

为什么用 Python 标准库而不是 Node 再写一遍：这是**交叉验证**。
zip 的 CRC 由 zipfile 独立算一遍、XML 由 ElementTree 独立解析一遍，
才能证明"我手写的 zip 头 + OOXML 骨架"不是只有我自己读得懂。

被 tools/verify-office-export.cjs 调用：先用同一套纯函数产出固定文件名的一批产物，
再由本脚本按约定路径逐个校验。两边靠**文件名契约**衔接，不传命令行参数，
免得 Windows 路径在 shell 里被转义搞坏。
"""

import os
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
RELS = '{http://schemas.openxmlformats.org/package/2006/relationships}'

fails = []
total = [0]


def ck(name, cond, detail=''):
    total[0] += 1
    if cond:
        print('  [ok]   ' + name)
    else:
        print('  [FAIL] ' + name + (('   -> ' + str(detail)) if detail else ''))
        fails.append(name)


def section(title):
    print('\n' + title)


def load(path):
    """读出整个包；顺便用 zipfile 自己的 CRC 实现校验一遍（这是独立于我们实现的判据）"""
    if not os.path.exists(path):
        ck('产物存在 ' + os.path.basename(path), False, path)
        return None
    z = zipfile.ZipFile(path)
    bad = z.testzip()
    ck(os.path.basename(path) + '：zip CRC 全部通过', bad is None, bad)
    return dict((n, z.read(n)) for n in z.namelist())


def parse(parts, name, required=True):
    if parts is None or name not in parts:
        if required:
            ck('包含 part ' + name, False, list(parts.keys()) if parts else None)
        return None
    try:
        return ET.fromstring(parts[name])
    except Exception as e:
        ck('part ' + name + ' 是合法 XML', False, str(e))
        return None


def all_text(root, tag):
    return ''.join((t.text or '') for t in root.iter(tag))


def check_zip_hygiene(parts, label):
    """包里每个 XML 都要能解析，且 [Content_Types].xml 的 Override 都得真实存在"""
    ok = True
    for name, data in parts.items():
        if not name.endswith('.xml') and not name.endswith('.rels'):
            continue
        try:
            ET.fromstring(data)
        except Exception as e:
            ok = False
            ck(label + '：' + name + ' 可解析', False, str(e))
    ck(label + '：全部 XML part 均可解析', ok)

    ct = parse(parts, '[Content_Types].xml')
    if ct is None:
        return
    missing = []
    for ov in ct.findall(CT + 'Override'):
        pn = ov.get('PartName')
        if pn and pn.lstrip('/') not in parts:
            missing.append(pn)
    ck(label + '：Content_Types 里每个 Override 都指向真实存在的 part', not missing, missing)

    # 每个 .rels 里的内部目标都要存在
    broken = []
    for name, data in parts.items():
        if not name.endswith('.rels'):
            continue
        try:
            root = ET.fromstring(data)
        except Exception:
            continue
        base = name.split('/_rels/')[0] if '/_rels/' in name else ''
        for rel in root.findall(RELS + 'Relationship'):
            if rel.get('TargetMode') == 'External':
                continue
            tgt = rel.get('Target') or ''
            full = (base + '/' + tgt).lstrip('/') if base else tgt.lstrip('/')
            # 归一化 ../ 这类相对路径
            bits = []
            for seg in full.split('/'):
                if seg == '..':
                    if bits:
                        bits.pop()
                elif seg and seg != '.':
                    bits.append(seg)
            full = '/'.join(bits)
            if full not in parts:
                broken.append(name + ' -> ' + tgt)
    ck(label + '：所有 .rels 的内部目标都存在', not broken, broken)


# ==================================================================== #
# docx
# ==================================================================== #

def check_docx_gongwen(path):
    """标准公文格式（GB/T 9704—2012）的关键版式参数逐条核对"""
    section('【A】docx —— 标准公文格式（GB/T 9704—2012）')
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'docx')

    for need in ['word/document.xml', 'word/styles.xml', 'word/settings.xml',
                 'word/footer1.xml', 'word/_rels/document.xml.rels',
                 '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml']:
        ck('包含 ' + need, need in parts)

    doc = parse(parts, 'word/document.xml')
    if doc is None:
        return
    ck('根元素是 w:document', doc.tag == W + 'document', doc.tag)
    body = doc.find(W + 'body')
    ck('有 w:body', body is not None)
    if body is None:
        return

    sect = body.find(W + 'sectPr')
    ck('有 w:sectPr（页面设置）', sect is not None)
    if sect is not None:
        pgsz = sect.find(W + 'pgSz')
        ck('纸张 A4：w=11906 h=16838 twips',
           pgsz is not None and pgsz.get(W + 'w') == '11906' and pgsz.get(W + 'h') == '16838',
           pgsz.attrib if pgsz is not None else None)

        mar = sect.find(W + 'pgMar')
        # 上37 / 下35 / 左28 / 右26 mm → twips
        want = {'top': '2098', 'bottom': '1984', 'left': '1587', 'right': '1474'}
        got = {}
        for k in want:
            got[k] = mar.get(W + k) if mar is not None else None
        ck('页边距 上37/下35/左28/右26 mm（2098/1984/1587/1474 twips）', got == want, got)

        grid = sect.find(W + 'docGrid')
        ck('文档网格按 28.8 磅行距（linePitch=576）',
           grid is not None and grid.get(W + 'linePitch') == '576',
           grid.attrib if grid is not None else None)

        fref = sect.find(W + 'footerReference')
        ck('sectPr 引用了页脚', fref is not None, None)

    # ---- 段落与 run 的字体字号 ----
    paras = body.findall(W + 'p')

    def run_font(p):
        r = p.find(W + 'r')
        if r is None:
            return None, None
        rp = r.find(W + 'rPr')
        if rp is None:
            return None, None
        f = rp.find(W + 'rFonts')
        sz = rp.find(W + 'sz')
        return (f.get(W + 'eastAsia') if f is not None else None,
                sz.get(W + 'val') if sz is not None else None)

    exact_line = 0
    first_line_indent = 0
    body_font = 0
    for p in paras:
        ppr = p.find(W + 'pPr')
        if ppr is not None:
            sp = ppr.find(W + 'spacing')
            if sp is not None and sp.get(W + 'line') == '576' and sp.get(W + 'lineRule') == 'exact':
                exact_line += 1
            ind = ppr.find(W + 'ind')
            if ind is not None and ind.get(W + 'firstLineChars') == '200':
                first_line_indent += 1
        ea, sz = run_font(p)
        if ea == '仿宋_GB2312' and sz == '32':
            body_font += 1

    ck('有段落使用固定行距 28.8 磅（line=576 exact）', exact_line > 0, exact_line)
    ck('有段落首行缩进 2 字符（firstLineChars=200）', first_line_indent > 0, first_line_indent)
    ck('正文 run 用三号仿宋_GB2312（sz=32 半磅）', body_font > 0, body_font)

    # 标题：居中 + 二号小标宋
    title_ok = False
    for p in paras:
        ppr = p.find(W + 'pPr')
        if ppr is None:
            continue
        jc = ppr.find(W + 'jc')
        ea, sz = run_font(p)
        if jc is not None and jc.get(W + 'val') == 'center' and ea == '方正小标宋简体' and sz == '44':
            title_ok = True
            break
    ck('标题：二号小标宋（sz=44）居中', title_ok)

    # 三级标题字体：黑体 / 楷体_GB2312 / 仿宋加粗
    fonts_used = set()
    for p in paras:
        for r in p.findall(W + 'r'):
            rp = r.find(W + 'rPr')
            if rp is None:
                continue
            f = rp.find(W + 'rFonts')
            if f is not None and f.get(W + 'eastAsia'):
                fonts_used.add(f.get(W + 'eastAsia'))
    ck('一级标题用黑体', '黑体' in fonts_used, sorted(fonts_used))
    ck('二级标题用楷体_GB2312', '楷体_GB2312' in fonts_used, sorted(fonts_used))

    # ---- 表格 ----
    tbls = body.findall(W + 'tbl')
    ck('生成了 Word 表格', len(tbls) >= 1, len(tbls))
    if tbls:
        tbl = tbls[0]
        grid = tbl.find(W + 'tblGrid')
        widths = [int(g.get(W + 'w')) for g in grid.findall(W + 'gridCol')] if grid is not None else []
        # 版心宽必须由页面尺寸与页边距**推导**，不能另外按 156mm 硬编码 ——
        # 两边都用 round 换算成 twips，差 1 个 twips 就对不上了
        pgsz = sect.find(W + 'pgSz') if sect is not None else None
        mar = sect.find(W + 'pgMar') if sect is not None else None
        content = (int(pgsz.get(W + 'w')) - int(mar.get(W + 'left')) - int(mar.get(W + 'right'))
                   if pgsz is not None and mar is not None else None)
        ck('表格列宽之和 = 版心宽（%s twips = 纸宽 - 左右边距）' % content,
           content is not None and sum(widths) == content, (sum(widths), widths))
        ck('每一列都分到了正数宽度（没有列被压成 0）',
           len(widths) > 0 and all(x > 0 for x in widths), widths)
        rows = tbl.findall(W + 'tr')
        ck('表格行数 = 表头 1 + 数据行', len(rows) >= 2, len(rows))
        if rows:
            head_cells = rows[0].findall(W + 'tc')
            ck('表头行单元格数与列数一致', len(head_cells) == len(widths), (len(head_cells), len(widths)))
            ck('表头行标记 tblHeader（跨页自动重复）', rows[0].find(W + 'trPr') is not None
               and rows[0].find(W + 'trPr').find(W + 'tblHeader') is not None)
            # 每个单元格里必须有段落，否则是非法结构
            no_p = []
            for r in rows:
                for tc in r.findall(W + 'tc'):
                    if tc.find(W + 'p') is None:
                        no_p.append(True)
            ck('每个单元格都含至少一个段落（结构合法）', not no_p, len(no_p))

    # ---- 正文里不该有 Markdown 符号残留 ----
    text = all_text(doc, W + 't')
    for bad in ['**', '##', '~~', '| ---']:
        ck('正文里没有残留 Markdown 符号 ' + repr(bad), bad not in text, text[:120])
    ck('正文里没有未展开的占位符 \\u0001', '\u0001' not in text)

    # ---- 页脚页码 ----
    ftr = parse(parts, 'word/footer1.xml')
    if ftr is not None:
        instrs = [f.get(W + 'instr') for f in ftr.iter(W + 'fldSimple')]
        ck('页脚含 PAGE 域（自动页码）', any((i or '').strip() == 'PAGE' for i in instrs), instrs)
        ftext = all_text(ftr, W + 't')
        ck('页码用「— 1 —」样式（数字左右各一条一字线）', '—' in ftext, repr(ftext))

    # ---- rels 交叉引用 ----
    rels = parse(parts, 'word/_rels/document.xml.rels')
    if rels is not None:
        byid = {}
        for rel in rels.findall(RELS + 'Relationship'):
            byid[rel.get('Id')] = rel.get('Target')
        ck('document.xml.rels 里有 styles / settings 关系',
           'styles.xml' in byid.values() and 'settings.xml' in byid.values(), byid)
        if sect is not None:
            fref = sect.find(W + 'footerReference')
            if fref is not None:
                rid = fref.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                ck('页脚关系 id 能解析到 footer1.xml',
                   byid.get(rid) == 'footer1.xml', (rid, byid.get(rid)))

    core = parse(parts, 'docProps/core.xml')
    if core is not None:
        ck('docProps 里有标题', core.find('{http://purl.org/dc/elements/1.1/}title') is not None)


def check_docx_plain(path):
    section('【B】docx —— 普通文档预设 / 空内容 / 脏字符')
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'docx-plain')
    doc = parse(parts, 'word/document.xml')
    if doc is None:
        return
    sect = doc.find(W + 'body/' + W + 'sectPr')
    if sect is not None:
        mar = sect.find(W + 'pgMar')
        ck('plain 页边距为 1 英寸（1440 twips）',
           mar is not None and mar.get(W + 'top') == '1440' and mar.get(W + 'left') == '1440',
           mar.attrib if mar is not None else None)
    text = all_text(doc, W + 't')
    ck('正文里没有残留 Markdown 符号 **', '**' not in text, text[:120])


def check_docx_empty(path):
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'docx-empty')
    doc = parse(parts, 'word/document.xml')
    if doc is None:
        return
    body = doc.find(W + 'body')
    ck('空内容也至少有一个段落（body 不能为空）',
       body is not None and body.find(W + 'p') is not None)


def check_docx_dirty(path):
    """控制字符、孤立代理项、脚本标签：都不能让 XML 变成非法"""
    section('【C】docx / xlsx —— 脏字符与注入防护')
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'docx-dirty')
    raw = parts.get('word/document.xml', b'')
    doc = parse(parts, 'word/document.xml')
    ck('含控制字符的文本没有破坏 XML（仍可解析）', doc is not None)
    if doc is None:
        return
    ck('原始字节里没有裸的 \\x00 \\x01 等控制字符',
       not any(b in raw for b in [b'\x00', b'\x01', b'\x02', b'\x0b', b'\x1f']))
    text = all_text(doc, W + 't')
    ck('script 标签被转义成文本（不含 <script）', '<script' not in raw.decode('utf-8', 'replace'))
    ck('文本里保留了 script 字面内容', 'script' in text, text[:200])


# ==================================================================== #
# xlsx
# ==================================================================== #

def check_xlsx_content(path, expect_tables):
    section('【D】xlsx —— 工作簿结构 / 单元格定位 / 数字类型')
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'xlsx')

    wb = parse(parts, 'xl/workbook.xml')
    if wb is None:
        return
    sheets = wb.find(SS + 'sheets').findall(SS + 'sheet')
    ck('工作表数量 = 1（内容）+ %d（表格）' % expect_tables, len(sheets) == 1 + expect_tables,
       [s.get('name') for s in sheets])
    names = [s.get('name') for s in sheets]
    ck('第一个工作表名为「内容」', names and names[0] == '内容', names)
    if expect_tables:
        ck('表格工作表按「表格N」命名',
           all(('表格' in n) for n in names[1:]), names[1:])

    rels = parse(parts, 'xl/_rels/workbook.xml.rels')
    byid = {}
    if rels is not None:
        for rel in rels.findall(RELS + 'Relationship'):
            byid[rel.get('Id')] = rel.get('Target')
    rid_attr = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
    targets = []
    for s in sheets:
        targets.append(byid.get(s.get(rid_attr)))
    ck('每个工作表的 r:id 都能解析到 worksheets/sheetN.xml',
       all(t and t.startswith('worksheets/sheet') for t in targets), targets)
    ck('workbook.rels 里声明了 styles.xml', 'styles.xml' in byid.values(), list(byid.values()))

    # ---- 内容工作表 ----
    s1 = parse(parts, 'xl/worksheets/sheet1.xml')
    if s1 is None:
        return
    dim = s1.find(SS + 'dimension')
    ck('内容表有 dimension', dim is not None and (dim.get('ref') or '').startswith('A1'),
       dim.attrib if dim is not None else None)
    cols = s1.find(SS + 'cols')
    ck('内容表设了列宽（customWidth）',
       cols is not None and cols.find(SS + 'col').get('customWidth') == '1')

    cells = list(s1.iter(SS + 'c'))
    ck('内容表有单元格', len(cells) > 0, len(cells))
    str_cells = [c for c in cells if c.get('t') == 'inlineStr']
    ck('字符串单元格用 inlineStr', len(str_cells) > 0, len(str_cells))
    ok_space = all((c.find(SS + 'is/' + SS + 't') is not None) for c in str_cells)
    ck('inlineStr 结构完整（is/t 齐全）', ok_space)
    texts = [''.join((t.text or '') for t in c.iter(SS + 't')) for c in cells]
    joined = '\n'.join(texts)
    ck('内容里没有残留 Markdown 加粗符号', '**' not in joined, joined[:160])
    # 数字：内容里放了 12345，必须是数字单元格才能直接求和
    numeric = [c for c in cells if c.get('t') is None and c.find(SS + 'v') is not None]
    ck('纯数字写成数字单元格（可直接求和，无文本绿三角）',
       any((c.find(SS + 'v').text or '') == '12345' for c in numeric),
       [(c.get('r'), c.find(SS + 'v').text) for c in numeric][:8])
    # 前导零的编号不能被当成数字
    ck('前导零编号保持文本（007 不被吞成 7）',
       all(not ((c.find(SS + 'v') is not None) and (c.find(SS + 'v').text or '').lstrip('-').startswith('0')
                and len((c.find(SS + 'v').text or '')) > 1) for c in numeric),
       [(c.get('r'), c.find(SS + 'v').text) for c in numeric][:8])

    # ---- 样式表索引对齐 ----
    st = parse(parts, 'xl/styles.xml')
    if st is not None:
        xfs = st.find(SS + 'cellXfs').findall(SS + 'xf')
        ck('cellXfs 数量与代码常量一致（10 个）', len(xfs) == 10, len(xfs))
        if len(xfs) > 4:
            ck('索引 3 是表头样式（带底色 fillId=2 + 边框 borderId=1）',
               xfs[3].get('fillId') == '2' and xfs[3].get('borderId') == '1', xfs[3].attrib)
            ck('索引 4 是数据单元格样式（带边框 borderId=1）',
               xfs[4].get('borderId') == '1', xfs[4].attrib)
        fonts = st.find(SS + 'fonts').findall(SS + 'font')
        ck('定义了中文字体（charset=134，避免乱码）',
           any(f.find(SS + 'charset') is not None and f.find(SS + 'charset').get('val') == '134' for f in fonts))
        fills = st.find(SS + 'fills').findall(SS + 'fill')
        ck('fill[0]/fill[1] 固定为 none / gray125（Excel 硬性约定）',
           len(fills) >= 2
           and fills[0].find(SS + 'patternFill').get('patternType') == 'none'
           and fills[1].find(SS + 'patternFill').get('patternType') == 'gray125')

    # ---- 表格工作表 ----
    if expect_tables:
        s2 = parse(parts, 'xl/worksheets/sheet2.xml')
        if s2 is not None:
            sv = s2.find(SS + 'sheetViews/' + SS + 'sheetView')
            pane = sv.find(SS + 'pane') if sv is not None else None
            ck('表格表冻结首行（pane ySplit=1）',
               pane is not None and pane.get('ySplit') == '1',
               pane.attrib if pane is not None else None)
            cells2 = list(s2.iter(SS + 'c'))
            styles_used = set(c.get('s') for c in cells2)
            ck('表格里用到了表头样式（s=3）与数据样式（s=4）',
               '3' in styles_used and '4' in styles_used, sorted(styles_used))
            rows2 = s2.findall(SS + 'sheetData/' + SS + 'row')
            head_row = rows2[0] if rows2 else None
            head_cells = head_row.findall(SS + 'c') if head_row is not None else []
            ck('表头行写满整行单元格', len(head_cells) >= 3, len(head_cells))
            head_text = [''.join((t.text or '') for t in c.iter(SS + 't')) for c in head_cells]
            ck('表头文字正确（含首列表头）', len(head_text) > 0 and head_text[0] == '姓名', head_text)
            body_text = ' '.join(
                ''.join((t.text or '') for t in c.iter(SS + 't'))
                for r in rows2[1:] for c in r.findall(SS + 'c')
            )
            ck('数据行落到了独立单元格（不再是 | 拼接的一行文本）',
               '液氯' in body_text and '剧毒' in body_text, body_text[:160])
            cols2 = s2.find(SS + 'cols')
            ck('表格列宽自适应（按内容设定）',
               cols2 is not None and len(cols2.findall(SS + 'col')) >= 3,
               len(cols2.findall(SS + 'col')) if cols2 is not None else None)


def check_xlsx_no_table(path):
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'xlsx-notable')
    wb = parse(parts, 'xl/workbook.xml')
    if wb is None:
        return
    sheets = wb.find(SS + 'sheets').findall(SS + 'sheet')
    ck('无表格时只有「内容」一个工作表', len(sheets) == 1, [s.get('name') for s in sheets])
    ck('无表格时不生成 sheet2.xml', 'xl/worksheets/sheet2.xml' not in parts)


# ==================================================================== #

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.tmp', 'office-out')


def p(name):
    return os.path.normpath(os.path.join(BASE, name))


def main():
    print('=' * 68)
    print('OOXML 产物校验（Python 标准库独立实现：zipfile 验 CRC，ElementTree 验 XML）')
    print('=' * 68)

    check_docx_gongwen(p('case-gongwen.docx'))
    check_docx_plain(p('case-plain.docx'))
    check_docx_empty(p('case-empty.docx'))
    check_docx_dirty(p('case-dirty.docx'))
    check_xlsx_content(p('case-content.xlsx'), 1)
    check_xlsx_no_table(p('case-notable.xlsx'))

    print('\n' + '=' * 68)
    if fails:
        print('结果：%d / %d 通过，%d 项失败' % (total[0] - len(fails), total[0], len(fails)))
        for f in fails:
            print('  失败：' + f)
        return 1
    print('结果：全部 %d 项通过' % total[0])
    return 0


if __name__ == '__main__':
    sys.exit(main())
