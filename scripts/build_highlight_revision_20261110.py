"""Create yellow-highlighted review drafts against the user-confirmed July sources.
Uses previously verified numerical/layout repairs, then adds reviewer clarifications.
No source DOCX or production app code is overwritten.
"""
from pathlib import Path
from copy import deepcopy
from difflib import SequenceMatcher
from functools import lru_cache
from hashlib import sha256
import json,re
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, Inches
from docx.text.paragraph import Paragraph
from sync_supp_formulas_20261009 import seq,sub,sup,frac,group,exp,log,root

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports/reviewer_revision_20261110'
OUT.mkdir(exist_ok=True)
evidence=json.loads((OUT/'evidence.json').read_text())
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
def txt(p):
    e=p._p if hasattr(p,'_p') else p
    return ''.join(e.xpath('.//w:t/text()|.//m:t/text()'))
def replace(p,text):
    for e in list(p._p):
        if e.tag!=qn('w:pPr'):p._p.remove(e)
    p.add_run(text)
def insert_after(p,text='',formula=None):
    e=OxmlElement('w:p');p._p.addnext(e);new=Paragraph(e,p._parent)
    if p._p.pPr is not None:e.append(deepcopy(p._p.pPr))
    pf=new.paragraph_format
    pf.keep_with_next=False;pf.keep_together=True;pf.page_break_before=False
    if formula is None:new.add_run(text)
    else:
        pf.space_before=Pt(3);pf.space_after=Pt(6)
        om=OxmlElement('m:oMath');om.extend(seq(formula));e.append(om)
    return new
def comment(doc,p,message):
    if not p.runs:p.add_run(' ')
    doc.add_comment(p.runs[0],text=message,author='Revision review',initials='RR')
def allparas(doc):return list(doc._element.xpath('.//w:body//w:p'))
def clear_comments(doc):
    for e in list(doc._element.xpath('.//w:commentRangeStart|.//w:commentRangeEnd|.//w:commentReference')):
        e.getparent().remove(e)
    try:
        for e in list(doc.comments._comments_elm):doc.comments._comments_elm.remove(e)
    except AttributeError:pass

def main_changes(doc):
    p=list(doc.paragraphs)
    replace(p[11],txt(p[11]).replace('and (v) to position','and (v) position'))
    # Keep source typography; introduce the most frequently used equations in the main text.
    anchor=insert_after(p[21],'For the models used most frequently below, u(t) = log10 N(t), u0 = log10 N0 and ures = log10 Nres. The log-linear, log-linear with tail, and Weibull forms are:')
    anchor=insert_after(anchor,formula=seq('u(t)=',sub('u','0'),'−',frac('t','D'),',   D=',frac('ln 10',sub('k','max'))))
    anchor=insert_after(anchor,formula=seq('u(t)=',log(seq(group(seq(sup('10',sub('u','0')),'−',sup('10',sub('u','res')))),exp(seq('−',sub('k','max'),'t')),'+',sup('10',sub('u','res'))))))
    anchor=insert_after(anchor,formula=seq('u(t)=',sub('u','0'),'−',sup(group(frac('t','δ')),'p')))
    insert_after(anchor,'In the tail model, N0 is the total initial population, Nres is the residual population, and N0 > Nres ≥ 0. The parameter kmax uses the natural-log rate convention. All 11 primary formulations, constraints and treatment-axis units are listed in Supplementary Table S1.')
    insert_after(p[23],'Primary regression uses every supplied individual observation with equal weight when raw replicate values are available. Otherwise, each supplied mean or digitized point contributes one observation; observations are not reconstructed from an SD or an assumed replicate count. The same observation set is used for optimization, n, SSE, model ranking, residuals and local parameter uncertainty. Secondary regression remains at the condition level. Treating all supplied observations equally does not account for within-experiment dependence or unequal residual variances.')
    insert_after(p[24],'Numerical convergence, model fit and parameter identifiability were interpreted separately. Low parameter sensitivity means that changing a parameter has little effect on the predicted observations; parameter confounding means that simultaneous changes in multiple parameters can compensate. The current interface warns about boundary estimates, unavailable or very large parameter SE, insufficient residual degrees of freedom, and nonconvergence. These are warning signs rather than a formal structural-identifiability test. A small residual or agreement across starts does not resolve a flat or correlated parameter direction. Where information is insufficient, a simpler model or an independently justified fixed parameter should be considered; an arbitrary fixed value does not supply missing experimental information.')
    a=insert_after(p[28],'For the T1 two-factor extended Bigelow model, the fitted relationship was:')
    a=insert_after(a,formula=seq(sub('log','10'),'D=',sub('log','10'),sub('D','ref'),'−',frac(seq('T−',sub('T','ref')),sub('z','T')),'−',frac(seq(sub('a','w'),'−',sub('a','w,ref')),sub('z','aw'))))
    insert_after(a,'The reference conditions were fixed at Tref = 70 °C and aw,ref = 0.33. The three free regression parameters were log10(Dref), zT and zaw; the reference conditions did not consume fitted degrees of freedom.')
    replace(p[36],txt(p[36])+' T2 was a forward prediction using fixed literature-derived parameters, not an inverse fit to the digitized dynamic observations. Dref and zT were therefore not estimated from T2 in this study, and no new parameter SE or confidence intervals were inferred from that comparison.')
    replace(p[41],txt(p[41])+' Checkpoint agreement within a single seeded run does not quantify between-seed variability or establish convergence of the 99.9th percentile. Repeat-run diagnostics for the T1 scenario are reported in Supplementary Table S4.')
    replace(p[80],txt(p[80]).replace('coupled to the fitted temperature-dependent D-value model','coupled to the literature-parameterized temperature-dependent D-value model'))
    insert_after(p[80],'For the unit conversion, log10[D(T)/s] = 14.03 − T/4.95 gives Dref = 10^(14.03 − 60/4.95) s, which is divided by 60 for a solver using minutes. Dref and zT were fixed inputs, and aw and pH were constant profile descriptors rather than separately estimated resistance effects in this T2 calculation. Consequently, Fig. 5 assesses a conditional survival trajectory and does not report dynamically fitted parameter confidence intervals.')
    # Add independently computed references without claiming a nonlinear global benchmark.
    primary=evidence['primaryReference'];secondary=evidence['secondaryReference']
    insert_after(p[72],f'An independent linear least-squares reference was used to check the T1 calculations on identical inputs. The primary log-linear curve has the closed-form representation u = a + bt, with kmax = −b ln(10) and D = −1/b. The extended Bigelow regression is linear in log10(Dref), −1/zT and −1/zaw. These references gave primary D = {primary["D"]:.6f} min and RMSE = {primary["rmse"]:.6f}, and secondary Dref = {secondary["Dref"]:.6f} min, zT = {secondary["zT"]:.6f} °C, zaw = {secondary["zaw"]:.6f}, and log10(D) RMSE = {secondary["rmse"]:.6f}; they agreed with the iterative implementation to the reported precision. This verifies the T1 least-squares computation but does not establish equivalence to the original source data or identify nonlinear models globally.')
    replace(p[83],txt(p[83]).replace('positivity transforms and process-factor bounds were applied as numerical constraints.', 'positive kinetic parameters were constrained through the sampling transformations. Process factors were sampled from the stated normal distributions, and draws producing invalid model predictions were rejected.'))
    s1,s2=evidence['summary']
    insert_after(p[84],f'To assess repeatability, the same fitted T1 scenario was run with 20 seed strings at each of 10,000 and 50,000 requested iterations. Across seeds, the 6-min success probability was {s1["successPercent"]["mean"]:.2f} ± {s1["successPercent"]["sd"]:.2f}% and {s2["successPercent"]["mean"]:.2f} ± {s2["successPercent"]["sd"]:.2f}% (mean ± between-seed SD), respectively. Exact log-linear inversion gave 99% target-time SDs of {s1["time99"]["sd"]:.3f} and {s2["time99"]["sd"]:.3f} min, compared with {s1["time999"]["sd"]:.3f} and {s2["time999"]["sd"]:.3f} min at 99.9% (Supplementary Table S4). The greater variability of the extreme tail supports checking sample size and seed sensitivity for the requested percentile rather than assigning a universal adequacy threshold of 10,000 iterations.')
    replace(p[95],txt(p[95]).replace('censoring near detection limits','left-censoring of log-count observations below detection limits')+' In particular, a small point-wise RMSE does not remove uncertainty in fitted parameters or digitized inputs. Residual normality tests do not establish equal variance or independence. The reported Monte Carlo distributions are conditional on the stated local parameter approximation and process-factor distributions, and may understate total predictive uncertainty when these assumptions fail. First-order Sobol indices and resampling-based confidence intervals are not implemented in this version, so total-effect indices cannot separate main effects from interactions. Client-side execution is an implementation choice, not a mathematical restriction preventing bootstrap, global estimation or Bayesian computation; such extensions require explicit algorithms and performance evaluation.')
    replace(p[100], 'The current web interface of MicroFit Pro is available at https://microfit.online. Routine analyses run in the user’s browser without requiring server-side upload of user data. The manuscript case-study inputs T1, T2 and N1–N5 are included as built-in examples; Table 1 identifies their literature sources. Figure-digitized inputs are reconstructions rather than original experimental replicate records. The source code is licensed under the MIT license. Numerical settings and random seeds for the T1 analyses are specified in the Methods and Supplementary Table S4.')
    comment(doc,p[100],'提交前必须落实：提供审稿人可访问的固定代码版本及数据/输出附件，并将经核实的仓库或匿名访问链接写入本节。目前本地 git 未配置远程地址，不能声称已提供审稿访问。还需确认线上网站是否为本次修订使用的代码版本。')
    comment(doc,p[95],'尚未完成的审稿证据：独立原始实验数据验证、数字化误差量化，以及数据支持下的异方差/相关误差分析。本版新增的闭式最小二乘核对和多随机种子表是数值验证，不替代上述证据。')
    comment(doc,p[67],'N5-Sa 内置样例已按原始 Excel 的 AE7:AF13 更正为完整七点，包含 (0,8)。已重算表2及正文；尺度参数仍有较大相对不确定性。')
    # Place full statistics formulas after the definitions already in the body.
    a=insert_after(p[24],formula=seq(sub('R','adj'),sup('','2'),'=1−',group(seq('1−',sup('R','2'))),frac('n−1','n−k')))
    insert_after(a,formula=seq(sub('AIC','c'),'=n ln',group(frac('SSE','n')),'−2',sub('ℓ','J'),'+2K+',frac('2K(K+1)','n−K−1'),',   K=k+1'))
    # Equation above uses conventional R_adj^2 without an empty superscript base.
    om=a._p.find(qn('m:oMath'))
    om.clear();om.extend(seq(sup(sub('R','adj'),'2'),'=1−',group(seq('1−',sup('R','2'))),frac('n−1','n−k')))
    insert_after(p[24],'Here ℓJ is the response-transformation log-Jacobian, zero for an untransformed response. Gaussian likelihood constants common to models fitted to the same observations and response scale are omitted. AICc comparisons are restricted to models with valid likelihoods on that common scale.')

def supplement_changes(doc):
    p=list(doc.paragraphs)
    insert_after(p[29],'For primary fitting, n counts all supplied individual observations after expanding raw replicate values. If individual values are unavailable, a supplied mean or digitized point is counted once. No observations are synthesized from an SD or assumed replicate count. Equal observation weights are used. The primary fit, diagnostics, AICc and covariance use the same observation set; secondary fits use one fitted kinetic response per condition.')
    insert_after(p[46],'A small Jacobian column indicates weak local sensitivity, whereas nearly dependent columns indicate that parameter combinations can compensate. Both can undermine practical identifiability even when the residual curve fits well. The implemented SE and boundary warnings screen for these issues but do not constitute a formal rank, profile-likelihood or structural-identifiability analysis. The corrected N5-Sa sample includes its measured zero-time count. Its fitted initial count is 8.009 and its shape is 0.123, with no shape-boundary warning, but the local scale SE exceeds the scale estimate. This illustrates that an observed initial count does not by itself ensure precise estimation of an extrapolated scale. Parameter fixing is scientifically justified only when the fixed value is supported independently; otherwise a simpler model or additional informative observations are needed.')
    replace(p[51],txt(p[51])+' Values below a detection limit are left-censored on the log-count scale and should not be treated as exact observed counts at the limit. The use of all supplied observations does not make repeated measurements independent. A variance model, weighted likelihood or correlation structure must be justified using the experimental design and available replicate information; inverse-SD-squared weighting is not automatically reliable when each SD is based on few replicates.')
    replace(p[93],txt(p[93]).replace('The implementation clips displayed ST values to [0, 2] and uses finite evaluation pairs','The implementation retains finite total-effect estimates above one without an upper cap and uses finite evaluation pairs').replace('invalid regions or clipped estimates weaken the formal Sobol interpretation','invalid regions and finite-sample error weaken the formal Sobol interpretation'))
    insert_after(p[79],'A repeat-run check used 20 seed strings, review-20261110-01 through review-20261110-20, at each of 10,000 and 50,000 requested iterations for the same fitted T1 model and uncertainty assumptions. Rejected draws were excluded from the denominator. The 6-min success fraction used draw-specific 5-log reductions. To isolate sampling error from saved-grid rounding, each target time was computed analytically as 5 ln(10)/kmax for the accepted log-linear draw; the q-quantile was the ceil(qN)th ordered value for N accepted draws. The seed labels were reused at both sample sizes. Supplementary Table S4 reports between-seed SD and range, not a confidence interval or a measure of biological uncertainty.')
    # Avoid a nearly empty page before the mathematical-formulation section.
    p[112].paragraph_format.page_break_before=False
    for pp in p[110:113]:
        for br in list(pp._p.xpath('.//w:br[@w:type="page"]')):br.getparent().remove(br)
    comment(doc,p[51],'待补证据：若取得原始重复数据，需评估异方差、同一实验内相关性及检出限处理；本版没有虚构加权拟合、bootstrap 或删失似然分析。')
    # Append a compact repeatability table after existing supplementary figures.
    title=doc.add_paragraph('Supplementary Table S4. Repeatability of T1 Monte Carlo outputs across 20 seed strings at two requested sample sizes.')
    title.paragraph_format.page_break_before=True;title.paragraph_format.keep_with_next=True
    table=doc.add_table(rows=1,cols=5)
    headings=['Requested draws','Output','Mean','Between-seed SD','Minimum–maximum']
    for c,h in zip(table.rows[0].cells,headings):c.text=h
    for s in evidence['summary']:
        for key,label,places in [('successPercent','Success at 6 min (%)',2),('time99','99% target time (min)',3),('time999','99.9% target time (min)',3)]:
            x=s[key];vals=[f'{s["nSamples"]:,}',label,f'{x["mean"]:.{places}f}',f'{x["sd"]:.{places}f}',f'{x["min"]:.{places}f}–{x["max"]:.{places}f}']
            for c,v in zip(table.add_row().cells,vals):c.text=v
    table.autofit=False
    widths=[1.1,1.7,1.0,1.15,1.55]
    for col,w in zip(table.columns,widths):col.width=Inches(w)
    for ri,row in enumerate(table.rows):
        pr=row._tr.get_or_add_trPr();pr.append(OxmlElement('w:cantSplit'))
        if ri==0:pr.append(OxmlElement('w:tblHeader'))
        for c,w in zip(row.cells,widths):
            c.width=Inches(w)
            tcpr=c._tc.get_or_add_tcPr()
            for side in ['top','left','bottom','right']:
                borders=tcpr.find(qn('w:tcBorders'))
                if borders is None:borders=OxmlElement('w:tcBorders');tcpr.append(borders)
                e=OxmlElement('w:'+side);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');borders.append(e)
            for pa in c.paragraphs:
                pa.paragraph_format.space_after=Pt(5);pa.paragraph_format.space_before=Pt(5);pa.paragraph_format.line_spacing=1;pa.paragraph_format.keep_with_next=False
                pa.paragraph_format.first_line_indent=Pt(0);pa.paragraph_format.left_indent=Pt(0);pa.paragraph_format.right_indent=Pt(0)
                pa.alignment=WD_ALIGN_PARAGRAPH.CENTER
                ind=pa._p.get_or_add_pPr().find(qn('w:ind'))
                if ind is not None:
                    ind.set(qn('w:firstLineChars'),'0');ind.set(qn('w:leftChars'),'0');ind.set(qn('w:rightChars'),'0')
                for r in pa.runs:r.font.size=Pt(10)
    doc.add_paragraph('Notes: All runs use the fitted T1 extended Bigelow model, nominal T = 70 °C, aw = 0.70, pH = 7, process SDs of 1 °C and 0.01 for temperature and aw, and the same primary- and secondary-parameter uncertainty settings as the main T1 scenario. Each statistic summarizes 20 runs. The accepted counts ranged from '+str(min(r['accepted'] for r in evidence['rows'] if r['nSamples']==10000))+' to 10,000 and from '+str(min(r['accepted'] for r in evidence['rows'] if r['nSamples']==50000))+' to 50,000, respectively. Target times use exact log-linear inversion rather than the 200-point display grid used for the original 15.8-min example. These results measure conditional numerical repeatability and do not validate the process model, parameter distributions or biological safety.')

# Highlight only inserted/replaced material relative to the original July DOCX.
def highlight_run(run):
    rp=run.find(qn('w:rPr'))
    if rp is None:
        rp=OxmlElement('w:rPr')
        # Math run properties precede Word run properties.
        run.insert(1 if len(run) and run[0].tag==qn('m:rPr') else 0,rp)
    h=rp.find(qn('w:highlight'))
    if h is None:h=OxmlElement('w:highlight');rp.append(h)
    h.set(qn('w:val'),'yellow')

def mark_all(e):
    for r in e.xpath('.//w:r|.//m:r'):
        if next(r.iter(qn('w:t')),None) is not None or next(r.iter(qn('m:t')),None) is not None:highlight_run(r)

def highlight_difference(old,new):
    oldtext=txt(old) if old is not None else ''
    newtext=txt(new)
    if oldtext==newtext:return 0
    if old is None:mark_all(new);return 1
    # Equations are atomic edits so all their tokens receive the same highlight.
    if old.xpath('.//m:oMath') or new.xpath('.//m:oMath'):
        mark_all(new);return 1
    a=re.findall(r'\s+|[\w]+|[^\w\s]',oldtext);b=re.findall(r'\s+|[\w]+|[^\w\s]',newtext)
    offsets=[0]
    for t in b:offsets.append(offsets[-1]+len(t))
    ops=SequenceMatcher(None,a,b,autojunk=False).get_opcodes()
    intervals=[(offsets[j1],offsets[j2]) for op,i1,i2,j1,j2 in ops if op in ['replace','insert'] and j1<j2]
    for op,i1,i2,j1,j2 in ops:
        if op=='delete' and b:
            j=min(j1,len(b)-1)
            while j<len(b)-1 and b[j].isspace():j+=1
            intervals.append((offsets[j],offsets[j+1]))
    at=0
    for r in list(new.xpath('.//w:r')):
        texts=r.xpath('./w:t')
        text=''.join(t.text or '' for t in texts);start,end=at,at+len(text);at=end
        if not text:continue
        if not any(l<end and h>start for l,h in intervals):continue
        if any(ch.tag not in [qn('w:rPr'),qn('w:t')] for ch in r):
            highlight_run(r);continue
        cuts={0,len(text)}
        for l,h in intervals:
            if l<end and h>start:cuts.update([max(0,l-start),min(len(text),h-start)])
        cuts=sorted(cuts)
        pieces=[]
        for l,h in zip(cuts,cuts[1:]):
            if l==h:continue
            nr=deepcopy(r)
            for ch in list(nr):
                if ch.tag!=qn('w:rPr'):nr.remove(ch)
            t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=text[l:h];nr.append(t)
            if any(x<start+h and y>start+l for x,y in intervals):highlight_run(nr)
            pieces.append(nr)
        parent=r.getparent();idx=parent.index(r)
        for nr in pieces:parent.insert(idx,nr);idx+=1
        parent.remove(r)
    return 1

def match_paragraphs(old,new):
    aa=[txt(x) for x in old];bb=[txt(x) for x in new];pairs={}
    for op,i1,i2,j1,j2 in SequenceMatcher(None,aa,bb,autojunk=False).get_opcodes():
        if op=='equal':
            for i,j in zip(range(i1,i2),range(j1,j2)):pairs[j]=i
        elif op=='replace':
            # Ordered dynamic alignment prevents a newly inserted paragraph
            # from being compared against an unrelated original paragraph.
            @lru_cache(None)
            def align(i,j):
                if i==i2:return (j2-j,[])
                if j==j2:return (i2-i,[])
                ratio=SequenceMatcher(None,aa[i],bb[j],autojunk=False).ratio()
                opts=[]
                c,p=align(i+1,j);opts.append((1+c,p))
                c,p=align(i,j+1);opts.append((1+c,p))
                if ratio>.2:
                    c,p=align(i+1,j+1);opts.append((1-ratio+c,[(i,j)]+p))
                return min(opts,key=lambda x:x[0])
            for i,j in align(i1,j1)[1]:pairs[j]=i
    return pairs

def highlight_doc(original,doc):
    # Clear inherited highlights, then regenerate a complete comparison.
    for h in list(doc._element.xpath('.//w:highlight')):h.getparent().remove(h)
    aa=list(original.paragraphs);bb=list(doc.paragraphs)
    pairs=match_paragraphs([p._p for p in aa],[p._p for p in bb]);changed=0
    for j,p in enumerate(bb):changed+=highlight_difference(aa[pairs[j]]._p if j in pairs else None,p._p)
    changed_cells=0
    for ti,table in enumerate(doc.tables):
        old=original.tables[ti] if ti<len(original.tables) else None
        for ri,row in enumerate(table.rows):
            for ci,cell in enumerate(row.cells):
                oldcell=old.rows[ri].cells[ci] if old is not None and ri<len(old.rows) and ci<len(old.rows[ri].cells) else None
                oldps=list(oldcell.paragraphs) if oldcell else []
                for pi,p in enumerate(cell.paragraphs):changed_cells+=highlight_difference(oldps[pi]._p if pi<len(oldps) else None,p._p)
    image_captions=[]
    for si,shape in enumerate(doc.inline_shapes):
        if si>=len(original.inline_shapes):continue
        oldshape=original.inline_shapes[si]
        rid=shape._inline.graphic.graphicData.pic.blipFill.blip.embed
        oldrid=oldshape._inline.graphic.graphicData.pic.blipFill.blip.embed
        if doc.part.related_parts[rid].blob==original.part.related_parts[oldrid].blob:continue
        par=shape._inline.getparent()
        while par is not None and par.tag!=qn('w:p'):par=par.getparent()
        nxt=par.getnext() if par is not None else None
        for attempt in range(6):
            if nxt is None:break
            if nxt.tag==qn('w:p') and re.match(r'^(?:Fig\.|Supplementary Fig\.)',txt(nxt)):
                mark_all(nxt);image_captions.append(txt(nxt)[:90]);break
            nxt=nxt.getnext()
    return {'changed_image_captions':image_captions,'changed_body_paragraphs':changed,'changed_cell_paragraphs':changed_cells,'yellow_runs':len(doc._element.xpath('.//w:highlight[@w:val="yellow"]'))}

def package_cleanup(path):
    # Remove obsolete modern-comment metadata inherited from earlier drafts.
    with ZipFile(path) as z:parts={n:z.read(n) for n in z.namelist()}
    removed=[n for n in parts if any(s in n for s in ['commentsIds.xml','commentsExtended.xml','commentsExtensible.xml','people.xml'])]
    for n in removed:del parts[n]
    for name in ['[Content_Types].xml','word/_rels/document.xml.rels']:
        root=etree.fromstring(parts[name])
        for e in list(root):
            target=e.get('PartName','')+e.get('Target','')
            if any(n.split('/')[-1] in target for n in removed):root.remove(e)
        parts[name]=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for n,data in parts.items():z.writestr(n,data)

before={}
audit={}
for stem,modify in [('dzb-7.8 MicroFit Pro正文',main_changes),('dzb-7.8 MicroFit 补充材料',supplement_changes)]:
    original=ROOT/(stem+'.docx');base=ROOT/(stem+'_修订版.docx')
    before[str(original)]=sha256(original.read_bytes()).hexdigest()
    doc=Document(base);clear_comments(doc);modify(doc)
    details=highlight_doc(Document(original),doc)
    output=ROOT/(stem+'_审稿修改版_黄色高亮.docx')
    doc.save(output);package_cleanup(output)
    reread=Document(output)
    details.update({'output':str(output),'paragraphs':len(reread.paragraphs),'tables':len(reread.tables),'images':len(reread.inline_shapes),'new_comments':len(reread.comments),'source_unchanged':before[str(original)]==sha256(original.read_bytes()).hexdigest()})
    audit[stem]=details
(OUT/'highlight_audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
(OUT/'pending_items.md').write_text('''# 本次审稿修改版尚待完成的事项\n\n本版是供作者核对的黄色高亮修改稿，不是已完成全部审稿要求的最终投稿包。\n\n- 提供审稿人可访问的固定代码版本、输入数据和输出附件，并补入真实访问地址；核对线上网站版本。\n- 获取可用的独立原始实验数据开展验证；当前数字化重建、T1闭式最小二乘核对和蒙特卡洛重复性不能替代独立实验验证。\n- 对数字化误差开展量化；若有原始重复数据，评估异方差、实验内相关性及检出限处理。\n- 针对非线性边界案例，可进一步用独立优化器、参数剖面或有实验依据的固定参数检查。当前T1解析核对不是所有非线性模型的独立求解器验证。\n- 按期刊要求完善审稿逐点回复并核对实际投稿PDF的图表编号与原文。\n\n已执行：同步此前已核实的公式、数值和结果图修正；明确全部观测统计口径；补充参数不可辨识及T2固定参数说明；新增20种子×两种样本量模拟结果表S4。所有新增、改写文字/数字/公式以黄色标记；替换的结果图由高亮图注指示。\n''')
print(json.dumps(audit,ensure_ascii=False,indent=2))
