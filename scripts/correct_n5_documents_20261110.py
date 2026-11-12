from pathlib import Path
import json,re,hashlib
from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml.ns import qn
from sync_paper_documents_20261009 import change_text

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/n5_source_correction_20261110'
fit=json.loads((REPORT/'n5_refits.json').read_text())['corrected']['fit']
pp=fit['params'];se=fit['paramErrors']
main_text=(f'For pulsed electric field treatment, two representative survival curves from Saldaña et al. (2010) were analyzed with the source-selected Weibull family. For Listeria monocytogenes STCC 5672 (N5-Lm), the program estimates were δ = 20.2 μs, p = 0.377 and RMSE = 0.048, compared with literature d = 21.39 μs, p = 0.36 and RMSE = 0.16. For Staphylococcus aureus STCC 4459 (N5-Sa, pH 3.5), the source worksheet contains seven observations, including time = 0 μs and log10(N) = 8. The built-in sample was corrected to match these source observations. The refitted estimates were log10(N0) = {pp["logN0"]:.3f}, δ = 1.738 × 10⁻⁴ μs and p = {pp["p"]:.3f}, with RMSE = {fit["rmse"]:.3f}. The estimates no longer reached the shape boundary. An independent variable-projection reference, using linear least squares at each candidate shape and a one-dimensional shape search, agreed with this fit. Nevertheless, the local scale SE was 3.717 × 10⁻⁴ μs, exceeding the scale estimate. Because the first positive-time observation occurs at 15.3 μs, δ remains an extrapolated one-log reduction time with substantial relative uncertainty; numerical convergence does not establish its biological precision.')
supp_text=('A small Jacobian column indicates weak local sensitivity, whereas nearly dependent columns indicate that parameter combinations can compensate. Both can undermine practical identifiability even when the residual curve fits well. The implemented SE and boundary warnings screen for these issues but do not constitute a formal rank, profile-likelihood or structural-identifiability analysis. The corrected N5-Sa sample includes its measured zero-time count. Its fitted initial count is 8.009 and its shape is 0.123, with no shape-boundary warning, but the local scale SE exceeds the scale estimate. This illustrates that an observed initial count does not by itself ensure precise estimation of an extrapolated scale. Parameter fixing is scientifically justified only when the fixed value is supported independently; otherwise a simpler model or additional informative observations are needed.')
scale_note='For N5-Sa, the corrected seven-point fit includes the zero-time observation; the local scale SE exceeds its estimate.'

# Fix regeneration sources as well as the current deliverables.
p=ROOT/'scripts/sync_paper_documents_20261009.py';s=p.read_text()
s=re.sub(r'^    replace_text\(p\[67\], f".*?"\)$',lambda m:'    replace_text(p[67], '+repr(main_text)+')',s,flags=re.M)
s=s.replace("elif identifier == 'N5-Sa': text = 'δ and initial count not identifiable; p = 0.010 (bound)'", "elif identifier == 'N5-Sa': text = f\"δ = {pp['delta']:.3g} μs; p = {pp['p']:.3f}; logN0 = {pp['logN0']:.3f}\"")
s=s.replace('N5-Sa parameters are practically unidentifiable despite numerical convergence.',scale_note)
s=s.replace('The N5-Sa numerical optimum is not practically identifiable and is explicitly qualified.','The N5-Sa built-in sample now matches all seven source points, including zero time; its small extrapolated scale retains substantial local uncertainty.')
p.write_text(s)
p=ROOT/'scripts/build_highlight_revision_20261110.py';s=p.read_text()
s=re.sub(r"^    insert_after\(p\[46\],'A small Jacobian column.*?\)$",lambda m:'    insert_after(p[46],'+repr(supp_text)+')',s,flags=re.M)
s=s.replace('本版保留 N5-Sa 参数不可辨识的明确警告。若需要固定初始菌数后重拟合，必须先获得有实验依据的 N0；不能把任意固定值作为已解决不可辨识性的证据。','N5-Sa 内置样例已按原始 Excel 的 AE7:AF13 更正为完整七点，包含 (0,8)。已重算表2及正文；尺度参数仍有较大相对不确定性。')
p.write_text(s)

changes=[]
for stem in ['dzb-7.8 MicroFit Pro正文','dzb-7.8 MicroFit 补充材料']:
 for suffix in ['_修订版.docx','_审稿修改版_黄色高亮.docx']:
  path=ROOT/(stem+suffix);doc=Document(path);highlight='黄色' in suffix;count=0
  def replace(p,text):
   p.text=text
   if highlight:
    for r in p.runs:r.font.highlight_color=WD_COLOR_INDEX.YELLOW
  if 'Pro正文' in stem:
   for p in doc.paragraphs:
    if p.text.startswith('For pulsed electric field treatment, two representative survival curves'):
     replace(p,main_text);count+=1
    elif 'N5-Sa parameters are practically unidentifiable despite numerical convergence.' in p.text:
     change_text(p,'N5-Sa parameters are practically unidentifiable despite numerical convergence.',scale_note)
     if highlight:
      for r in p.runs:
       if scale_note in r.text:r.font.highlight_color=WD_COLOR_INDEX.YELLOW
     count+=1
   for row in doc.tables[1].rows:
    if row.cells[0].text.strip()=='N5-Sa':
     for index,text in [(3,f'δ = {pp["delta"]:.3g} μs; p = {pp["p"]:.3f}; logN0 = {pp["logN0"]:.3f}'),(5,f'{fit["rmse"]:.3f}'),(6,f'{fit["rmse"]-.18:.3f}')]:
      replace(row.cells[index].paragraphs[0],text)
     count+=1
   assert count==3,(path,count)
  else:
   for p in doc.paragraphs:
    if 'For the present N5-Sa digitized curve' in p.text:
     replace(p,supp_text);count+=1
   assert count==(1 if highlight else 0),(path,count)
  # Remove stale review comments which repeated the erroneous interpretation.
  try:
   for comment in doc.comments:
    if 'N5-Sa' in comment.text:
     for i,p in enumerate(comment.paragraphs):
      p.text=('N5-Sa source transcription corrected: all seven source observations, including (0,8), are retained. Fitted initial count and shape are finite and interior; scale uncertainty remains large.' if i==0 else '')
  except AttributeError:pass
  doc.save(path);changes.append({'file':str(path),'changes':count})

# Revised response paragraphs; the reviewer's original comments remain untouched.
p=ROOT/'scripts/build_reviewer_response_20261110.py';s=p.read_text()
old="'The revised N5-Sa example illustrates this problem directly."
new="'We checked the N5-Sa data against the source worksheet and corrected the built-in sample to retain all seven observations, including (0 μs, 8 log10 units). The refit gives log10(N0) = 8.009, p = 0.123 and RMSE = 0.187, without the former shape-boundary estimate. The local scale estimate is 1.738 × 10⁻⁴ μs with SE 3.717 × 10⁻⁴ μs; thus the scale still has substantial relative uncertainty and is flagged by the existing SE-based screening. We have removed the incorrect claim that the source curve lacked a zero-time observation. We have not fitted the Huang (2009) example; the current warnings do not constitute a complete identifiability diagnosis.'"
lines=s.splitlines()
for i,line in enumerate(lines):
 if line.startswith(old):lines[i]=new
 if line.startswith("'The revised table and discussion also distinguish boundary estimates"):
  lines[i]="'The N5-Sa data were also audited against the source worksheet. The previous built-in six-point sample did not match the source: it omitted the observed zero-time count and contained different positive-time coordinates and counts. The corrected seven-point sample includes (0 μs, 8 log10 units). The new estimates are log10(N0) = 8.009, δ = 1.738 × 10⁻⁴ μs and p = 0.123, with RMSE = 0.187; the previous p = 0.010 boundary result and extreme initial count are not results for the corrected source data. An independent variable-projection check agrees with the corrected fit. The scale remains extrapolated far below the first positive observation at 15.3 μs and its local SE (3.717 × 10⁻⁴ μs) exceeds its estimate. The N1 f = 0.999 results remain boundary warnings, and these numerical checks do not establish precise biological estimation of every parameter.',"
 if line.startswith("'We have also clarified statistical bookkeeping."):
  lines[i]=line.replace('An independent nonlinear optimizer or global-search benchmark has not yet been completed. The T1 linear reference must not be taken as verification of every nonlinear fit.','The T1 linear reference and the new N5-Sa scalar-profile check verify those specific least-squares calculations. An independent optimizer benchmark for the remaining nonlinear boundary cases has not yet been completed.')
 if line.startswith("'AUTHOR ACTION REQUIRED: Complete an independent nonlinear-solver check"):
  lines[i]=line.replace('for the problematic boundary curves','for the remaining problematic boundary curves').replace('The current linear T1 check does not satisfy that additional benchmark.','The T1 linear check and the corrected N5-Sa variable-projection check do not verify every nonlinear model.')
s='\n'.join(lines)+'\n'
# Resolve line ranges only after rendering the corrected manuscripts.
s=s.replace("items=[]", "items=[]\nreference_update_path=REPORT/'reference_updates_n5.json'\nreference_updates=json.loads(reference_update_path.read_text()) if reference_update_path.exists() else {}")
s=s.replace("items.append(dict(id=id,heading=heading,comment=comment,response=response,refs=refs,action=action))", "refs=[tuple(reference_updates.get(f'{name}:{a}:{b}',[name,a,b])) for name,a,b in refs]\n items.append(dict(id=id,heading=heading,comment=comment,response=response,refs=refs,action=action))")
p.write_text(s)
(REPORT/'document_corrections.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2))
print(json.dumps(changes,ensure_ascii=False,indent=2))
