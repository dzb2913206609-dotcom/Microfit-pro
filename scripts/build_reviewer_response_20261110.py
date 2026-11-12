from pathlib import Path
import re, json, hashlib
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT=Path('/Users/dengzhengbin/Desktop/microbial-inactivation-app _副本')
REPORT=ROOT/'reports/reviewer_revision_20261110'
SOURCE=Path('/Users/dengzhengbin/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_ll1dm6len31322_e50a/temp/drag/reviewers comments.docx')
OUT=ROOT/'MicroFit Pro_审稿逐点回复_含行号_待补项黄色标记.docx'
source=Document(SOURCE)
r3=source.paragraphs[1].text
u=source.paragraphs[3].text
r3markers=['Especially when there are more than 3 parameters','2.6.2 Line 392-406.','Lines 602-623:']
def split_markers(text,markers):
 pos=[text.index(m) for m in markers]
 return text[:pos[0]].strip(),[text[a:(pos[i+1] if i+1<len(pos) else len(text))].strip() for i,a in enumerate(pos)]
r3intro,r3comments=split_markers(r3,r3markers)
major_text,minor_text=u.split('3. Minor Comments',1)
uoverview,major=split_markers(major_text,['2.1. Complete Absence','2.2. Numerical Optimization','2.3. Overclaimed','2.4. Inadequate','2.5. Client-Side'])
minor_markers=['Section 1 Typo (Line 102):','Omission of Explicit Mathematical Equations','Clarification of RMSE Recalculation Methods:','Sensitivity of Monte Carlo Risk Metrics','Figure Resolution and Readability:','Code Availability and Reviewer Access:']
_,minor=split_markers(minor_text,minor_markers)
# Verbatim segments retain the source wording, including errors within quoted comments.
assert len(r3comments)==3 and len(major)==5 and len(minor)==6
items=[]
reference_update_path=REPORT/'reference_updates_n5.json'
reference_updates=json.loads(reference_update_path.read_text()) if reference_update_path.exists() else {}
def add(id,heading,comment,response,refs,action=None):
 refs=[tuple(reference_updates.get(f'{name}:{a}:{b}',[name,a,b])) for name,a,b in refs]
 items.append(dict(id=id,heading=heading,comment=comment,response=response,refs=refs,action=action))

add('R3.1','Parameter identifiability and user guidance',r3comments[0],[
'Thank you for highlighting this distinction. We have revised the Methods to separate numerical convergence, goodness of fit and parameter identifiability. The number of parameters alone does not determine identifiability: it depends on the model and the information in the observations. A small residual is compatible with weakly determined parameters, especially when the treatment range is narrow or an initial count is not observed.',
'The current program flags nonconvergence, estimates near declared bounds, insufficient residual degrees of freedom, and unavailable or very large local standard errors. These are screening warnings; the program does not perform a formal structural-identifiability, Jacobian-rank or profile-likelihood analysis, and it does not automatically identify a particular parameter that should be fixed. We now state these limits explicitly. Where information is inadequate, the revised text recommends a simpler model, additional informative observations, or a fixed parameter supported independently of the fitted curve. Fixing an arbitrary value does not restore missing experimental information.',
],[('main',193,202),('supp',131,135)])

add('R3.2','Low sensitivity versus correlated parameters',r3comments[1],[
'We agree that these are distinct problems. If changing a parameter has little effect on the fitted observations, the corresponding local Jacobian column is small. If two parameters compensate for one another, the relevant columns are nearly dependent even when each column is individually appreciable. Either situation can make the information matrix unreliable and inflate or prevent calculation of local parameter uncertainty.',
'We have added this distinction to the main text and Supplementary Methods. The current SE and boundary warnings can indicate weak information, but they do not reliably distinguish these two causes or prescribe which member of a correlated pair to hold constant. Deterministic multi-start fitting may reduce dependence on starting values, but it cannot supply information in a flat parameter direction. For the first case, more observations in an informative experimental range or a simpler model may be needed. For the second, fixing one parameter is justified only if its value is supported independently; reporting only the remaining conditional fit must not imply that both original parameters were estimated.'
],[('main',193,202),('supp',131,135)])

add('R3.3','T2 dynamic prediction and parameter confidence intervals',r3comments[2],[
'Thank you for pointing out this ambiguity. We did not estimate Dref or z from the T2 dynamic observations. Figure 5 compares a forward prediction with digitized observations; the prediction curve was not fitted to those observations. The previous phrase “fitted temperature-dependent D-value model” could imply dynamic parameter estimation. We have revised the Methods, Results and Fig. 5 caption to make the calculation and parameter source explicit.',
'The fixed inputs were obtained from the isothermal relationship reported by Huang (2013): log10[D(T)/s] = 14.03 − T/4.95, where T is expressed in °C. Rewriting this relationship in Bigelow form at Tref = 60 °C gives Dref = 10^(14.03 − 60/4.95) s = approximately 81.1 s (1.35 min) and z = zT = 4.95 °C. These values were supplied to the log-linear inactivation model for the temperature profile increasing linearly from 30 to 65 °C over 28 min. The fourth-order Runge–Kutta method numerically integrates the resulting differential equation for the specified inputs; it does not estimate Dref or z.',
'Accordingly, no parameter standard errors or 95% confidence intervals were estimated from T2. Treating the inputs as fixed for this calculation does not imply that their source estimates have zero uncertainty. The RMSE of 0.610 log10 CFU/g against 33 digitized observations describes prediction agreement conditional on these inputs, rather than the precision of dynamically estimated parameters. The revised text now states: “T2 was a forward prediction using fixed literature-derived parameters, not an inverse fit to the digitized dynamic observations.”'
],[('main',282,296),('main',642,657),('main',1074,1082)])

add('U2.1','2.1. Original experimental data and digitization uncertainty',major[0],[
'We agree that reconstruction of published figures cannot replace validation against independent raw experimental observations. The present seven case-study datasets remain literature-derived, and no new laboratory experiments have been added. We have revised the Abstract, evaluation description and limitations to frame the evidence as a software and workflow demonstration rather than independent experimental validation.',
'The revised text explicitly identifies digitization uncertainty as unquantified and states that small residuals do not remove uncertainty in the input points. A new independent linear least-squares calculation on identical T1 inputs checks the numerical implementation, but it does not validate the digitized coordinates, reproduce the original replicate data or establish biological predictive performance. We therefore do not present that calculation, the dynamic comparison or the repeat-seed Monte Carlo results as a substitute for the requested raw-data validation.',
'The concern about independent experimental validation and the quantitative effect of digitization remains unresolved in the current evidence package. Obtaining an independent raw dataset and assessing reconstruction uncertainty are necessary additional steps before claiming that those aspects have been addressed.'
],[('main',14,29),('main',571,578),('main',764,795)],
'AUTHOR ACTION REQUIRED: Add an independent raw-data validation and a quantitative digitization-error analysis, or agree with the editor on an explicitly narrower software-demonstration scope. Insert the actual data source, analysis, results and revised line references here. These analyses have not been completed.')

add('U2.2','2.2. Optimization, parameter bounds and literature discrepancies',major[1],[
'We have revised both the numerical description and the interpretation of the boundary cases. The production workflow uses constrained Levenberg–Marquardt fitting with a scaled projected-gradient convergence criterion, deterministic multi-start fitting for models with at least three free parameters (up to 30 generic starts), and working-axis scaling with log coordinates for positive dimensional parameters when appropriate. Reaching an iteration or damping limit is treated as nonconvergence. Finite differences and multiple starts do not provide a proof of global optimality; the revised text makes that limitation clear.',
'For T1, the current two-step secondary estimates are Dref = 12.654393 min, zT = 18.519818 °C and zaw = 0.394868 at Tref = 70 °C and aw,ref = 0.33. An independent linear least-squares reference on the same inputs gives the same values to the reported precision, together with log10(D) RMSE = 0.143135. The corresponding representative primary fit gives D = 54.199942 min and RMSE = 0.205840. This checks the current least-squares computation; it does not reconcile the original source estimates (17.61 min, 24.03 °C and 0.44). The revised Results retain that discrepancy and discuss the different digitized inputs and estimation workflow without treating the difference as negligible.',
'The N5-Sa data were also audited against the source worksheet. The previous built-in six-point sample did not match the source: it omitted the observed zero-time count and contained different positive-time coordinates and counts. The corrected seven-point sample includes (0 μs, 8 log10 units). The new estimates are log10(N0) = 8.009, δ = 1.738 × 10⁻⁴ μs and p = 0.123, with RMSE = 0.187; the previous p = 0.010 boundary result and extreme initial count are not results for the corrected source data. An independent variable-projection check agrees with the corrected fit. The scale remains extrapolated far below the first positive observation at 15.3 μs and its local SE (3.717 × 10⁻⁴ μs) exceeds its estimate. The N1 f = 0.999 results remain boundary warnings, and these numerical checks do not establish precise biological estimation of every parameter.',
'We have also clarified statistical bookkeeping. RMSE uses sqrt(SSE/n), adjusted R² uses residual degrees of freedom n − k, and Gaussian AICc counts K = k + 1, including residual variance. AICc is reported only when n > K + 1 and the compared models use a valid likelihood on the same observations and response scale; transformed secondary responses include the response Jacobian. The T1 linear reference and the new N5-Sa scalar-profile check verify those specific least-squares calculations. An independent optimizer benchmark for the remaining nonlinear boundary cases has not yet been completed.'
],[('main',153,202),('main',512,519),('main',555,578),('main',1018,1033),('supp',78,139)],
'AUTHOR ACTION REQUIRED: Complete an independent nonlinear-solver check for the remaining problematic boundary curves, and document the model, bounds, starts, objective values and identifiability assessment. The T1 linear check and the corrected N5-Sa variable-projection check do not verify every nonlinear model.')

add('U2.3','2.3. Cross-technology claims and thermal demonstration scope',major[2],[
'We agree that implementing a model library does not establish that the complete downstream workflow has been validated for every processing technology. We have chosen to narrow the claims. The title identifies cross-technology primary fitting and thermal workflow demonstration. The Abstract and objectives distinguish primary fitting across thermal and non-thermal examples from the T1 thermal secondary/uncertainty/sensitivity demonstration and the T2 thermal dynamic comparison.',
'The limitations now state that the evidence supports implementation feasibility rather than comprehensive external validation across all processing technologies. We have not added non-thermal secondary or dynamic datasets in this revision, and no such validation is claimed. The revised scope also avoids presenting MicroFit Pro as a replacement for specialized global-fitting, Bayesian or full QMRA tools.'
],[('main',1,3),('main',14,29),('main',78,89),('main',755,780)])

add('U2.4','2.4. Error structure, detection limits and propagated uncertainty',major[3],[
'We agree with the concern. The current estimation framework is unweighted least squares with an approximate homoscedastic Gaussian residual model on the fitted response scale. It does not implement weighted NLS, a censored-data likelihood or a within-experiment correlation model. We now state these limitations and their implications for Monte Carlo outputs explicitly, rather than implying that a residual normality test validates the full error structure.',
'Primary fitting now uses every supplied individual observation when raw replicates are available; if only a mean or digitized point is supplied, that value counts once. The fit, SSE, n, ranking and covariance use the same observations. This convention prevents inconsistent sample counting, but it does not make repeated observations independent or correct unequal variances. An appropriate variance or dependence model requires information about the experimental design and replicates; inverse-SD-squared weights estimated from very few replicates are not automatically reliable.',
'We have also clarified the censoring terminology: a count known only to be below a detection limit is left-censored on the log-count scale. Such a value should not be treated as an exact measurement at the limit. The reported Monte Carlo distributions remain conditional on the fitted local parameter approximation and the specified process distributions; they omit structural uncertainty and may understate total predictive uncertainty if the assumptions fail. No claim of complete statistical correction is made.'
],[('main',164,170),('main',772,795),('supp',145,156)],
'AUTHOR ACTION REQUIRED: If a statistical extension is included in this revision, provide raw replicate/design information and implement and validate the selected variance, censoring or dependence model. The current manuscript acknowledges these limitations; WLS and censored/correlated-data inference are not implemented.')

add('U2.5','2.5. Browser computation, Monte Carlo tails and Sobol interpretation',major[4],[
'We have revised the discussion to distinguish the scope of the present implementation from what is mathematically possible in a browser. Client-side execution does not inherently prevent bootstrap, global regression or Bayesian computation. These methods require dedicated algorithms and performance evaluation, and they are not implemented in the current version. The discussion identifies optional one-step or Bayesian extensions; a WebAssembly numerical core or an optional hybrid backend would be possible future engineering approaches, not features that have been delivered in this revision.',
'The Sobol output is now described explicitly as total-effect screening. First-order indices and resampling confidence intervals are not estimated, so the present output cannot isolate main effects from higher-order interactions. Finite-sample total-effect estimates need not sum to one and can exceed one; normalized bar heights are relative influence summaries. We have removed any interpretation of their sum as a complete additive decomposition.',
'To quantify seed and sample-size sensitivity for the reported T1 scenario, we added 20 independent seed labels at each of 10,000 and 50,000 requested draws (40 runs in total). The 6-min success probability was 28.24% (between-seed SD 0.45 percentage points) and 28.32% (SD 0.24 percentage points), respectively. Exact-inversion 99% target-time SDs were 0.242 and 0.116 min; 99.9% target-time SDs were 0.830 and 0.354 min. Table S4 reports means and ranges as well as SDs. Rejected draws are excluded from the success denominator. These results show the larger variability of the extreme tail for this scenario; they do not establish a universally adequate sample count or biological safety.',
'The Methods now distinguish checkpoint agreement within one run from between-seed repeatability. We no longer use the default of 10,000 draws as evidence that every percentile has converged.'
],[('main',325,328),('main',670,686),('main',703,710),('main',788,800),('supp',239,247),('supp',273,296),('supp',464,473)])

add('U3.1','3.1. Typographical correction',minor[0],[
'Corrected. The objectives now read “The objectives are to: ... and (v) position the platform ...”. The stray “o” has been removed, with “to” supplied by the introductory clause.'
],[('main',82,89)])

add('U3.2','3.2. Mathematical equations in the main manuscript',minor[1],[
'We have added explicit log-linear, log-linear-with-tail and Weibull equations and their parameter definitions to the main manuscript. The two-factor extended Bigelow equation, its reference conditions and the number of free parameters are also stated directly. The full primary model formulations remain in Supplementary Table S1 and the complete secondary library is listed in Supplementary Table S2.',
'This change only partly addresses the requested expansion: explicit biphasic, full Geeraerd shoulder, Arrhenius and Ratkowsky equations have not yet all been added to the main manuscript. We do not claim that the present revision contains the complete requested set.'
],[('main',142,151),('main',229,233),('supp',443,443),('supp',445,447)],
'AUTHOR ACTION REQUIRED: Add the remaining requested biphasic, Geeraerd shoulder, Arrhenius and Ratkowsky equations with definitions and constraints to the main text, then regenerate the numbered manuscript and update every affected line reference in this response letter.')

add('U3.3','3.3. RMSE definitions and reconstructed literature comparisons',minor[2],[
'We have clarified the denominator in both the Methods and Table 2 note. Program prediction RMSE is sqrt(SSE/n). The quantity sqrt[SSE/(n − k)] is labelled residual standard error and is not used as prediction RMSE. Here n is the number of supplied observations and k includes all freely estimated regression parameters, including an estimated intercept or initial count.',
'The revised Table 2 note also separates source-reported metrics from approximate reconstructions. T1-primary is a conditional reconstruction with source D = 60.49 min fixed and an intercept fitted to the 13 digitized observations. N2 RMSE values are reconstructed approximately from reported adjusted R² and digitized-data SST assuming three total regression parameters; N3 values are reconstructed from reported R² and digitized-data SST. These reconstructed RMSEs use denominator n. They are not directly reported single-curve RMSE values from the original studies.',
'We further clarify that ΔRMSE means program minus literature, that source-reported quantities retain their original data scope and definitions, and that the T1 secondary condition-level log10(D) RMSE differs from the linked survival-count RMSE. Differences between these descriptive comparisons are not proof of superior predictive performance.'
],[('main',164,190),('main',555,578),('main',1011,1028),('supp',110,125)])

add('U3.4','3.4. Sensitivity to pseudo-random seeds',minor[3],[
'We have added a repeat-run analysis with seed labels review-20261110-01 through review-20261110-20, each used at 10,000 and 50,000 requested draws under the same T1 fitted model and uncertainty assumptions. At 10,000 draws, the 6-min success probability was 28.24% with between-seed SD 0.45 percentage points (range 27.34–29.03%); at 50,000 draws it was 28.32% with SD 0.24 percentage points (range 27.89–28.75%).',
'The 99% target time was 15.910 ± 0.242 min and 15.911 ± 0.116 min, respectively (mean ± between-seed SD). At 99.9%, the corresponding values were 21.287 ± 0.830 min and 21.505 ± 0.354 min. Target times in this additional check use exact log-linear inversion, 5 ln(10)/kmax, and the ceil(qN)th ordered accepted value, so that saved-grid rounding does not confound sampling variability. These SDs quantify numerical repeatability, not biological confidence intervals.',
'We also corrected the original single-seed 6-min result to 2793/10,000 = 27.9%, rather than 27.8%. Its grid-based 99% target time remains 15.8 min, with 15.78 min from exact inversion of the same draws. The new table supports scenario-specific checks of the requested percentile; it does not certify universal extreme-tail convergence.'
],[('main',670,686),('supp',239,247),('supp',464,473)])

add('U3.5','3.5. Figure readability',minor[4],[
'Figures 3 and 6 have been replaced with scientific plots generated from the recomputed results. Figure 3 shows the extended Bigelow response surface and an observed-versus-predicted D-value parity plot. Figure 6 shows survival percentile bands, the 6-min reduction distribution, OAT influence and SRC screening results, with readable axes and legends. High-resolution raster images are embedded in the Word manuscript and separate SVG figure sources are available in the revision workspace.',
'The revised captions explain the response scale and the conditional interpretation of the uncertainty/sensitivity outputs. Morris and Sobol screening remain in Supplementary Figs. S1 and S2. The replacement addresses the readability issue without relying on small browser-interface text.'
],[('main',1057,1062),('main',1085,1092)])

add('U3.6','3.6. Code availability during peer review',minor[5],[
'We agree that a working interface and an MIT licence statement alone do not provide a reproducible reviewer-accessible code release. The availability section now describes the web interface and the built-in literature-derived case-study inputs without claiming that a fixed review archive has already been supplied.',
'A repository URL, release tag or archived snapshot accessible to the reviewers has not yet been provided in the present revision package. This request therefore remains open. The final availability statement and this response must be updated with a real, tested access route and the exact version used for the reported calculations before resubmission.'
],[('main',822,829)],
'AUTHOR ACTION REQUIRED: Insert a working reviewer-accessible repository or archive URL, the immutable tag/commit or archive identifier, and the input/output files needed to reproduce the reported results. Verify access from a reviewer account and then update Section 5 and its line references. Do not submit this placeholder.')

# Verify every cited range against extracted, printed manuscript line numbers.
maps={k:json.loads((REPORT/(k+'_line_map.json')).read_text()) for k in ['main','supp']}
for item in items:
 for name,a,b in item['refs']:
  available={r['line'] for r in maps[name]}
  assert all(n in available for n in range(a,b+1)),(item['id'],name,a,b)

doc=Document()
sec=doc.sections[0]
sec.page_width=Inches(8.27);sec.page_height=Inches(11.69)
sec.top_margin=sec.bottom_margin=Inches(.8)
sec.left_margin=sec.right_margin=Inches(.85)
normal=doc.styles['Normal'];normal.font.name='Times New Roman';normal.font.size=Pt(11)
normal.paragraph_format.line_spacing=1.1
normal.paragraph_format.space_after=Pt(6)
for style,size in [('Title',19),('Heading 1',15),('Heading 2',12),('Heading 3',11)]:
 st=doc.styles[style];st.font.name='Times New Roman';st.font.size=Pt(size);st.font.color.rgb=RGBColor(0,0,0)
 st.paragraph_format.keep_with_next=True
 st.paragraph_format.space_before=Pt(12);st.paragraph_format.space_after=Pt(6)
for name in ['Reviewer comment','Author action','Location']:
 if name not in doc.styles: doc.styles.add_style(name,1)
 doc.styles[name].base_style=normal
commentstyle=doc.styles['Reviewer comment'];commentstyle.font.size=Pt(10.5)
commentstyle.paragraph_format.left_indent=Inches(.18)
commentstyle.paragraph_format.right_indent=Inches(.08)
commentstyle.paragraph_format.space_after=Pt(5)
doc.styles['Location'].font.size=Pt(10)
doc.styles['Location'].font.italic=True

def p(text,style=None,bold=False,color=None,highlight=False):
 v=doc.add_paragraph(style=style)
 rr=v.add_run(text);rr.bold=bold
 if color:rr.font.color.rgb=RGBColor.from_string(color)
 if highlight:rr.font.highlight_color=WD_COLOR_INDEX.YELLOW
 v.paragraph_format.widow_control=True
 return v

def quote(text):
 for part in text.split('\n\n'):
  if part.strip():p(part, 'Reviewer comment')

def location(item):
 chunks=[]
 for name,a,b in item['refs']:
  records=[r for r in maps[name] if a<=r['line']<=b and not (r['line']<70 and r['page']>4)]
  pages=sorted(set(r['page'] for r in records))
  pagestr=str(pages[0]) if len(pages)==1 else f'{pages[0]}–{pages[-1]}'
  lines=str(a) if a==b else f'{a}–{b}'
  label='Main manuscript' if name=='main' else 'Supplementary Material'
  if name=='supp' and any('Supplementary Table S1.' in r['text'] for r in records): label+=' (Table S1 caption; table on p. 21)'
  if name=='supp' and any('Supplementary Table S2.' in r['text'] for r in records): label+=' (Table S2)'
  if name=='supp' and any('Supplementary Table S4.' in r['text'] for r in records): label+=' (Table S4 and notes)'
  if name=='main' and any(r['text'].startswith('Fig. 3 ') for r in records):label+=' (Fig. 3 caption; figure on p. 49)'
  if name=='main' and any(r['text'].startswith('Fig. 6 ') for r in records):label+=' (Fig. 6 caption; figure on p. 52)'
  chunks.append(f'{label}, lines {lines}, '+('p. ' if len(pages)==1 else 'pp. ')+pagestr)
 return 'Revised locations: '+'; '.join(chunks)+'.'

doc.add_heading('Response to reviewers',0)
p('MicroFit Pro',bold=True)
p('Dear Editor and Reviewers,')
p('Thank you for the careful evaluation of our manuscript and for the constructive comments. We provide a point-by-point response below. The revision clarifies the scope of the evaluation, numerical and statistical definitions, identifiability limitations and the interpretation of uncertainty analyses. It also includes repeat-seed Monte Carlo checks and revised result figures. Where the requested evidence or material is still unavailable, the outstanding action is identified explicitly.')
p('All locations below refer to the yellow-highlighted revised main manuscript and Supplementary Material dated 10 November 2026. Line numbering is continuous within each document and restarts independently in the Supplementary Material. Page numbers refer to their checked PDF renders. Reviewer-supplied line numbers retained inside comments refer to the earlier submission. Table cells and figure artwork are located using the caption/note line range and the page, rather than invented cell or artwork line numbers.',style='Location')
p('AUTHOR CHECK BEFORE SUBMISSION: Yellow text marks unresolved author actions and must be completed or replaced by an agreed scientific response. The supplied file labels Reviewer 3 but does not identify the reviewer for the additional report; confirm that identity before submission. Any further manuscript edits can shift line numbers, so recheck all locations against the final submission PDF.',style='Author action',highlight=True)

doc.add_heading('Reviewer 3',1)
p('General comment',bold=True);quote(r3intro)
p('Response',bold=True).paragraph_format.keep_with_next=True
p('Thank you for the positive assessment of the platform and the case studies. We address the specific questions below.')
for item in items[:3]:
 doc.add_heading(item['id']+'. '+item['heading'],2)
 p('Comment',bold=True).paragraph_format.keep_with_next=True;quote(item['comment'])
 p('Response',bold=True).paragraph_format.keep_with_next=True
 for paragraph in item['response']:p(paragraph,color='17365D')
 p(location(item),'Location')

doc.add_heading('Additional reviewer report',1)
p('AUTHOR CHECK: The reviewer number for the following report was not included in the supplied comments file. Confirm it before submission. Comment numbering 2.1–2.5 and the order of the six minor comments are preserved below.',style='Author action',highlight=True)
p('General assessment',bold=True);quote(uoverview)
p('Response',bold=True).paragraph_format.keep_with_next=True
p('Thank you for the detailed assessment. We have used the concerns below to distinguish implemented functionality from the evidence available to evaluate it, and to identify the remaining validation and reproducibility requirements.')
for i,item in enumerate(items[3:]):
 if i==0:doc.add_heading('2. Main concerns',2)
 if i==5:doc.add_heading('3. Minor comments',2)
 doc.add_heading(item['heading'],3)
 p('Comment',bold=True).paragraph_format.keep_with_next=True;quote(item['comment'])
 p('Response',bold=True).paragraph_format.keep_with_next=True
 for paragraph in item['response']:p(paragraph,color='17365D')
 p(location(item),'Location')
 if item['action']:p(item['action'],'Author action',highlight=True)

p('We thank the Editor and Reviewers for helping us improve the precision, transparency and presentation of the work.')
footer=sec.footer.paragraphs[0];footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=footer.add_run();r.font.name='Times New Roman';r.font.size=Pt(9)
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');r._r.addnext(fld)
doc.core_properties.title='Response to reviewers – MicroFit Pro'
doc.core_properties.subject='Point-by-point responses with verified revised-manuscript line locations'
doc.core_properties.author=''
doc.core_properties.keywords='reviewer response; MicroFit Pro; verified line references'
# Strip inherited template rules and theme overrides for a plain response letter.
for st in doc.styles:
 for border in list(st.element.iter(qn('w:pBdr'))):
  border.getparent().remove(border)
 if st.type == 1:
  st.font.name = 'Times New Roman'
  fonts = st.element.find('.//' + qn('w:rFonts'))
  if fonts is not None:
   for attr in ('asciiTheme','hAnsiTheme','eastAsiaTheme','cstheme'):
    fonts.attrib.pop(qn('w:'+attr), None)
   fonts.set(qn('w:ascii'), 'Times New Roman')
   fonts.set(qn('w:hAnsi'), 'Times New Roman')
for para in doc.paragraphs:
 for border in list(para._p.iter(qn('w:pBdr'))):
  border.getparent().remove(border)
doc.save(OUT)

# Audit exact source coverage and preserve location evidence separately from the deliverable.
written=Document(OUT)
alltext='\n'.join(v.text for v in written.paragraphs)
comments=[r3intro,*r3comments,uoverview,*major,*minor]
for comment in comments:
 for part in comment.split('\n\n'):
  assert part.strip() in alltext,part[:80]
assert len(items)==14
assert all(item['response'] and item['refs'] for item in items)
sourcefiles=[ROOT/'dzb-7.8 MicroFit Pro正文_审稿修改版_黄色高亮.docx',ROOT/'dzb-7.8 MicroFit 补充材料_审稿修改版_黄色高亮.docx']
audit={'readiness':'draft_with_placeholders','output':str(OUT),'response_count':len(items),'reviewer_comments_verbatim':True,'yellow_author_action_count':len([p for p in written.paragraphs if any(r.font.highlight_color==WD_COLOR_INDEX.YELLOW for r in p.runs)]),'source_hashes':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in sourcefiles},'items':items}
(REPORT/'response_audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
md=['# Verified response locations','', 'Readiness: draft_with_placeholders','']
for item in items:
 md.extend(['## '+item['id']+' '+item['heading'],'',location(item),''])
 for name,a,b in item['refs']:
  recs=[r for r in maps[name] if a<=r['line']<=b and (r['line']>=70 or r['page']<=4)]
  md.extend(f"- {name}, p. {r['page']}, line {r['line']}: {r['text']}" for r in recs)
 if item['action']:md.extend(['',item['action']])
 md.append('')
(REPORT/'response_line_reference_map.md').write_text('\n'.join(md))
print(json.dumps({k:audit[k] for k in ['output','readiness','response_count','reviewer_comments_verbatim','yellow_author_action_count']},ensure_ascii=False,indent=2))
