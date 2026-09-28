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
    section('【C】docx —— 脏字符与注入防护')
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
# 排版回归（跨语言再验一次：Node 侧已断言，这里用 ElementTree 独立复算）
# ==================================================================== #

def check_layout_regressions(gongwen_path, softbreak_path):
    section('【D】docx —— 排版回归：软换行不拉伸 / 分割线不落地')

    # --- 软换行段落必须左对齐 ---
    parts = load(softbreak_path)
    if parts:
        doc = parse(parts, 'word/document.xml')
        body = doc.find(W + 'body') if doc is not None else None
        paras = body.findall(W + 'p') if body is not None else []

        multi = [p for p in paras if list(p.iter(W + 'br'))]
        ck('样本里有且仅有 1 个含软换行的段落', len(multi) == 1, len(multi))

        for p in multi:
            ppr = p.find(W + 'pPr')
            jc = ppr.find(W + 'jc') if ppr is not None else None
            val = jc.get(W + 'val') if jc is not None else None
            ck('多行段落是左对齐（w:jc=left）', val == 'left', val)
            ck('多行段落不是两端对齐（否则短行会被拉到版心宽）', val != 'both', val)
            ck('软换行数正确（3 行 → 2 个 w:br）', len(list(p.iter(W + 'br'))) == 2,
               len(list(p.iter(W + 'br'))))
            text = all_text(p, W + 't')
            ck('软换行段落三行文字都在（没被拆散或吞掉）',
               '应急指挥部' in text and '总指挥' in text and '成员' in text, repr(text[:80]))

        # 反面对照：单行正文段落仍然是两端对齐
        both = [p for p in paras
                if not list(p.iter(W + 'br'))
                and (p.find(W + 'pPr') is not None and p.find(W + 'pPr').find(W + 'jc') is not None
                     and p.find(W + 'pPr').find(W + 'jc').get(W + 'val') == 'both')]
        ck('单行正文段落仍是两端对齐（没有把整篇都改左对齐）', len(both) == 1, len(both))

    # --- 分割线不落地 ---
    parts = load(gongwen_path)
    if parts:
        doc = parse(parts, 'word/document.xml')
        if doc is not None:
            ck('分割线不生成段落下边框（正文里没有 w:pBdr）',
               len(list(doc.iter(W + 'pBdr'))) == 0)
            text = all_text(doc, W + 't')
            ck('分割线没有留下横线字符', '---' not in text, repr(text[:160]))
            ck('分割线前后的正文都还在（只丢了那一行）',
               '12345' in text and '本预案自发布之日起施行' in text, repr(text[-80:]))


# ==================================================================== #
# 纯文本 TXT
# ==================================================================== #

def check_txt(path):
    """TXT 是给人粘贴用的：编码、换行、以及"有没有把 Markdown 符号一起带出来"都要卡死"""
    section('【E】纯文本 TXT —— 编码 / 换行 / 语法符号')
    if not os.path.exists(path):
        ck('产物存在 case-content.txt', False, path)
        return
    raw = open(path, 'rb').read()
    ck('case-content.txt 存在且非空', len(raw) > 200, len(raw))
    ck('开头是 UTF-8 BOM（EF BB BF，记事本才不会糊中文）',
       raw[:3] == b'\xef\xbb\xbf', raw[:6])

    text = raw.decode('utf-8-sig')
    ck('换行全部是 CRLF（没有裸 LF）', '\n' not in text.replace('\r\n', ''), repr(text[:80]))
    ck('没有残留 Markdown 加粗/斜体符号', '**' not in text and '~~' not in text)
    ck('没有分割线横杠', '----------' not in text and '---' not in text, repr(text[:160]))
    ck('没有残留的表格分隔行', '| ---' not in text)
    ck('没有残留的代码围栏', '```' not in text)
    ck('正文内容完整（关键句都在）',
       '危险化学品' in text and '本预案自发布之日起施行' in text)
    ck('表格被拍平成可读文本（表头与单元格都在）',
       '危险特性' in text and '液氯' in text)


# ==================================================================== #

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.tmp', 'office-out')


def p(name):
    return os.path.normpath(os.path.join(BASE, name))


def main():
    print('=' * 68)
    print('导出产物校验（Python 标准库独立实现：zipfile 验 CRC，ElementTree 验 XML）')
    print('=' * 68)

    check_docx_gongwen(p('case-gongwen.docx'))
    check_docx_plain(p('case-plain.docx'))
    check_docx_empty(p('case-empty.docx'))
    check_docx_dirty(p('case-dirty.docx'))
    check_layout_regressions(p('case-gongwen.docx'), p('case-softbreak.docx'))
    check_txt(p('case-content.txt'))

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
