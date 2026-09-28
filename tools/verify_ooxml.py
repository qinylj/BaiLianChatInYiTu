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
import re
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
    """公文格式的关键版式参数逐条核对：
       页边距上 3.5 / 下 2.9 / 左 2.55 / 右 2.55 cm，行距固定值 29.7 磅，
       标题方正小标宋_GBK、正文方正仿宋_GBK 三号、层次序数换字体"""
    section('【A】docx —— 公文格式（页面设置 / 行距 / 字体 / 层次序数）')
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
        # 上 3.5 / 下 2.9 / 左 2.55 / 右 2.55 cm → twips（与 ooxml.mm 同一套 round 换算）
        want = {'top': '1984', 'bottom': '1644', 'left': '1446', 'right': '1446'}
        got = {}
        for k in want:
            got[k] = mar.get(W + k) if mar is not None else None
        ck('页边距 上3.5/下2.9/左2.55/右2.55 cm（1984/1644/1446/1446 twips）', got == want, got)

        grid = sect.find(W + 'docGrid')
        ck('文档网格按固定行距 29.7 磅（linePitch=594）',
           grid is not None and grid.get(W + 'linePitch') == '594',
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
            if sp is not None and sp.get(W + 'line') == '594' and sp.get(W + 'lineRule') == 'exact':
                exact_line += 1
            ind = ppr.find(W + 'ind')
            if ind is not None and ind.get(W + 'firstLineChars') == '200':
                first_line_indent += 1
        ea, sz = run_font(p)
        if ea == '方正仿宋_GBK' and sz == '32':
            body_font += 1

    ck('有段落使用固定行距 29.7 磅（line=594 exact）', exact_line > 0, exact_line)
    ck('有段落首行缩进 2 字符（firstLineChars=200）', first_line_indent > 0, first_line_indent)
    ck('正文 run 用方正仿宋_GBK 三号（sz=32 半磅）', body_font > 0, body_font)

    # 标题：居中 + 二号小标宋
    title_ok = False
    for p in paras:
        ppr = p.find(W + 'pPr')
        if ppr is None:
            continue
        jc = ppr.find(W + 'jc')
        ea, sz = run_font(p)
        if jc is not None and jc.get(W + 'val') == 'center' and ea == '方正小标宋_GBK' and sz == '44':
            title_ok = True
            break
    ck('标题：方正小标宋_GBK 二号（sz=44）居中', title_ok)

    # 层次序数 → 字体：一、（黑体）/（一）（楷体）/ 1.（1）（仿宋，与正文同）
    fonts_used = set()
    for p in paras:
        for r in p.findall(W + 'r'):
            rp = r.find(W + 'rPr')
            if rp is None:
                continue
            f = rp.find(W + 'rFonts')
            if f is not None and f.get(W + 'eastAsia'):
                fonts_used.add(f.get(W + 'eastAsia'))
    ck('第一层（一、）用方正黑体_GBK', '方正黑体_GBK' in fonts_used, sorted(fonts_used))
    ck('第二层（（一））用方正楷体_GBK', '方正楷体_GBK' in fonts_used, sorted(fonts_used))

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
    section('【D】docx —— 排版回归：手动换行换回车 / 分割线不落地')

    def jc_of(p):
        ppr = p.find(W + 'pPr')
        jc = ppr.find(W + 'jc') if ppr is not None else None
        return jc.get(W + 'val') if jc is not None else None

    # --- 手动换行符（Shift+Enter）必须换成回车（¶）：每行独立成段 ---
    parts = load(softbreak_path)
    if parts:
        doc = parse(parts, 'word/document.xml')
        body = doc.find(W + 'body') if doc is not None else None
        paras = body.findall(W + 'p') if body is not None else []

        ck('整篇不再有手动换行符（w:br 数为 0）',
           len(list(doc.iter(W + 'br'))) == 0, len(list(doc.iter(W + 'br'))))
        ck('3 行短句拆成 3 个独立段落（+ 标题段 + 首行段 = 5 段）',
           len(paras) == 5, len(paras))

        body_paras = paras[1:]
        ck('正文段落全部两端对齐（w:jc=both，恢复了公文的对齐方式）',
           all(jc_of(p) == 'both' for p in body_paras), [jc_of(p) for p in body_paras])
        ck('文档标题仍居中（没有顺手把整篇改成别的对齐）',
           jc_of(paras[0]) == 'center', jc_of(paras[0]))
        ck('每段文字各是一行（拆段没拆散、也没吞内容）',
           [all_text(p, W + 't') for p in body_paras] ==
           ['一、应急组织机构', '应急指挥部', '总指挥：企业主要负责人',
            '成员：生产、安全、环保、医疗等部门负责人'],
           [all_text(p, W + 't') for p in body_paras])

        firsts = []
        for p in body_paras:
            ppr = p.find(W + 'pPr')
            ind = ppr.find(W + 'ind') if ppr is not None else None
            firsts.append(ind.get(W + 'firstLineChars') if ind is not None else None)
        ck('拆出来的段落都带首行缩进 2 字符（是正经段落，不是靠空格凑的）',
           firsts == ['200'] * 4, firsts)

    # --- 分割线不落地 + 全局不变式 ---
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

            # 不变式：谁把带 \n 的文本直接丢给段落生成器，这里就会红
            bad = [all_text(p, W + 't') for p in doc.iter(W + 'p')
                   if jc_of(p) == 'both' and list(p.iter(W + 'br'))]
            ck('不变式：两端对齐的段落里没有手动换行符（否则短行字距会被拉开）',
               len(bad) == 0, bad)


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
# Markdown 原文（渲染前的原数据）
# ==================================================================== #

def check_md(path):
    """MD 是"渲染前的原数据"：Python 侧只验**没被加工过**，越原样越好"""
    section('【F】Markdown 原文 —— 渲染前的原数据不得被加工')
    if not os.path.exists(path):
        ck('产物存在 case-content.md', False, path)
        return
    raw = open(path, 'rb').read()
    ck('case-content.md 存在且非空', len(raw) > 200, len(raw))
    ck('不带 BOM（带了就不再是原数据）', raw[:3] != b'\xef\xbb\xbf', raw[:6])
    text = raw.decode('utf-8')
    ck('换行保持原样（LF，没有被转成 CRLF）', '\r' not in text, repr(text[:80]))
    ck('Markdown 语法符号全在（渲染前该有的样子）',
       '**危险化学品**' in text and '| --- |' in text and '```bash' in text)
    ck('分割线 `---` 仍是原文的一部分（只有 Word 导出才丢它）', '\n---\n' in text)
    ck('正文内容完整（关键句都在）',
       '本预案自发布之日起施行' in text and '液氯' in text)


# ==================================================================== #

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.tmp', 'office-out')


def p(name):
    return os.path.normpath(os.path.join(BASE, name))


def check_ordinal(path):
    """层次序数换字体 + 多余空格清理（用 ElementTree 独立复算一遍）"""
    section('【G】docx —— 层次序数换字体 / 多余空格清理')
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'docx-ordinal')
    doc = parse(parts, 'word/document.xml')
    if doc is None:
        return
    body = doc.find(W + 'body')
    paras = body.findall(W + 'p') if body is not None else []
    ck('有正文段落', len(paras) >= 8, len(paras))

    def para_font(p):
        r = p.find(W + 'r')
        rp = r.find(W + 'rPr') if r is not None else None
        f = rp.find(W + 'rFonts') if rp is not None else None
        return f.get(W + 'eastAsia') if f is not None else None

    fonts = {}
    for p in paras:
        fonts.setdefault(all_text(p, W + 't'), para_font(p))

    # 四种序数各对应一档字体（序数可以越级，互不影响）
    for text, want in [('一、总体要求', '方正黑体_GBK'),
                       ('（一）指导思想', '方正楷体_GBK'),
                       ('1.工作原则', '方正仿宋_GBK'),
                       ('（1）坚持预防为主', '方正仿宋_GBK')]:
        ck('层次序数 %r → %s' % (text, want), fonts.get(text) == want, fonts.get(text))

    ck('没有序数的正文行仍是方正仿宋_GBK',
       fonts.get('总指挥：企业主要负责人') == '方正仿宋_GBK',
       fonts.get('总指挥：企业主要负责人'))

    # 多余空格：用空格摆版式的短句被合并
    ck('用空格对齐的短句被合并（总指挥：   企业主要负责人 → 无空格）',
       '总指挥：企业主要负责人' in fonts, [t for t in fonts if '总指挥' in t])
    ck('「成员：  生产、安全…」里的多余空格被清掉',
       '成员：生产、安全、环保等部门负责人' in fonts, [t for t in fonts if '成员' in t])
    ck('全角空格与首尾空白都被清掉（「  第一章　　总则   」→「第一章总则」）',
       '第一章总则' in fonts, [t for t in fonts if '第一章' in t])

    # 反向：不该动的空格一个都没动
    ck('中英文之间 / 数字前后的空格保留（依据 GB/T 9704 标准编制，共 30 人参与。）',
       '依据 GB/T 9704 标准编制，共 30 人参与。' in fonts,
       [t for t in fonts if 'GB' in t])
    ck('行内代码里的空格原样保留（a  b  c）',
       '代码里的空格不能动：a  b  c' in fonts, [t for t in fonts if '代码里' in t])

    dirty = [t for t in fonts if 'a  b  c' not in t and ('  ' in t or '\u3000' in t)]
    ck('全篇再没有连续空格 / 全角空格（代码段除外）', not dirty, dirty)

    used = set(f for f in fonts.values() if f)
    ck('字体只用了公文允许的四种（标题小标宋 + 三档层次）',
       used <= {'方正小标宋_GBK', '方正黑体_GBK', '方正楷体_GBK', '方正仿宋_GBK'},
       sorted(used))


def check_frame(path):
    """标题块：副标题 / 前言位置 / emoji 清理（独立复算一遍）"""
    section('【H】docx —— 标题块（副标题 / 前言位置 / emoji 清理）')
    parts = load(path)
    if not parts:
        return
    check_zip_hygiene(parts, 'docx-frame')
    doc = parse(parts, 'word/document.xml')
    if doc is None:
        return
    body = doc.find(W + 'body')
    paras = body.findall(W + 'p') if body is not None else []
    ck('有正文段落', len(paras) >= 5, len(paras))

    def para_font(p):
        r = p.find(W + 'r')
        rp = r.find(W + 'rPr') if r is not None else None
        f = rp.find(W + 'rFonts') if rp is not None else None
        return f.get(W + 'eastAsia') if f is not None else None

    def para_jc(p):
        pr = p.find(W + 'pPr')
        j = pr.find(W + 'jc') if pr is not None else None
        return j.get(W + 'val') if j is not None else None

    texts = [all_text(p, W + 't') for p in paras]
    i_lead = next((i for i, t in enumerate(texts) if t.startswith('以下是为长寿区制定的')), -1)
    i_title = next((i for i, t in enumerate(texts) if t == '长寿区数字重庆建设三年行动计划'), -1)
    i_sub = next((i for i, t in enumerate(texts) if t == '（2025-2027年）'), -1)

    ck('前言排在标题上面', i_lead >= 0 and i_title >= 0 and i_lead < i_title,
       {'lead': i_lead, 'title': i_title, 'head': texts[:4]})
    ck('副标题紧排在标题下面', i_title >= 0 and i_sub == i_title + 1,
       {'title': i_title, 'sub': i_sub, 'head': texts[:4]})
    ck('前言是正文字体（方正仿宋_GBK）',
       i_lead >= 0 and para_font(paras[i_lead]) == '方正仿宋_GBK',
       para_font(paras[i_lead]) if i_lead >= 0 else '(缺失)')
    ck('前言是两端对齐的正文段', i_lead >= 0 and para_jc(paras[i_lead]) == 'both',
       para_jc(paras[i_lead]) if i_lead >= 0 else '(缺失)')
    ck('标题是方正小标宋_GBK 居中',
       i_title >= 0 and para_font(paras[i_title]) == '方正小标宋_GBK' and para_jc(paras[i_title]) == 'center',
       (para_font(paras[i_title]), para_jc(paras[i_title])) if i_title >= 0 else '(缺失)')
    ck('副标题是方正楷体_GBK 居中',
       i_sub >= 0 and para_font(paras[i_sub]) == '方正楷体_GBK' and para_jc(paras[i_sub]) == 'center',
       (para_font(paras[i_sub]), para_jc(paras[i_sub])) if i_sub >= 0 else '(缺失)')
    ck('副标题只出现一次', texts.count('（2025-2027年）') == 1,
       [t for t in texts if '2025' in t])

    joined = '|'.join(texts)
    ck('emoji 不进 Word（✅ 已清掉）', '✅' not in joined, [t for t in texts if '✅' in t])
    ck('emoji 与文字之间的空格也没留下',
       any(t.startswith('政务服务：区级事项') for t in texts), [t for t in texts if '政务服务' in t])
    ck('引号旁边的空格清掉（打造 “…” 品牌 → 无缝）',
       any('打造“数字长寿·智联江城”品牌。到 2027 年实现：' in t for t in texts),
       [t for t in texts if '打造' in t])
    ck('有序列表序号后面不留空格（1. 算力网络 → 1.算力网络）',
       '1.算力网络：新建 2 个边缘计算节点。' in texts, [t for t in texts if '算力网络' in t])

    dirty = [t for t in texts if '  ' in t or '\u3000' in t]
    ck('全篇没有连续空格 / 全角空格', not dirty, dirty)
    emo = re.compile('[\\u2600-\\u27BF\\u2B50-\\u2B55]|[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]')
    ck('全篇没有 emoji 残留', not any(emo.search(t) for t in texts),
       [t for t in texts if emo.search(t)])

    used = set(f for f in (para_font(p) for p in paras) if f)
    ck('字体只用了公文允许的四种',
       used <= {'方正小标宋_GBK', '方正黑体_GBK', '方正楷体_GBK', '方正仿宋_GBK'},
       sorted(used))


def main():
    print('=' * 68)
    print('导出产物校验（Python 标准库独立实现：zipfile 验 CRC，ElementTree 验 XML）')
    print('=' * 68)

    check_docx_gongwen(p('case-gongwen.docx'))
    check_docx_plain(p('case-plain.docx'))
    check_docx_empty(p('case-empty.docx'))
    check_docx_dirty(p('case-dirty.docx'))
    check_layout_regressions(p('case-gongwen.docx'), p('case-softbreak.docx'))
    check_ordinal(p('case-ordinal.docx'))
    check_frame(p('case-frame.docx'))
    check_txt(p('case-content.txt'))
    check_md(p('case-content.md'))

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
