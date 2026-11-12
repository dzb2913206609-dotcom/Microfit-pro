"""Regenerate manuscript figures from the current production calculation exports.

Existing manuscript figure workflow uses Python. All plotted observations,
bands and rankings here are read from saved production-function output.
"""
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch, FancyBboxPatch

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'reports/paper_sync_20261009'
OUT = DATA / 'figures'
OUT.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 8,
                     'axes.titlesize': 9, 'axes.labelsize': 8, 'xtick.labelsize': 7,
                     'ytick.labelsize': 7, 'legend.fontsize': 7,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'svg.fonttype': 'none', 'pdf.fonttype': 42})
COLORS = {'factor': '#438D93', 'model': '#BB6677', 'secondary': '#8973AC'}


def load(name):
    return json.loads((DATA / (name + '.json')).read_text())


def save(fig, name):
    for ext in ['png', 'svg', 'pdf']:
        fig.savefig(OUT / f'{name}.{ext}', dpi=400, facecolor='white')
    plt.close(fig)


def label(row, noise=False):
    name = row['param'].split(':')[-1]
    return {'temp': 'Temperature', 'aw': 'Water activity', 'pH': 'pH',
            'logN0': r'$\log_{10} N_0$', 'kmax': 'Primary rate noise' if noise else r'$k_{max}$',
            'logDref': r'$\log_{10} D_{ref}$', 'zT': r'$z_T$', 'zaw': r'$z_{aw}$'}.get(name, name)


def bars(ax, result, title, noise=False):
    rows = result['results']
    y = np.arange(len(rows))
    ax.barh(y, [r['contribution'] for r in rows],
            color=[COLORS[r['category']] for r in rows], height=.64)
    ax.set_yticks(y, [label(r, noise) for r in rows])
    ax.invert_yaxis()
    ax.set_xlim(0, max(50, max(r['contribution'] for r in rows) * 1.16))
    for i, r in enumerate(rows):
        ax.text(r['contribution'] + .6, i, f"{r['contribution']:.1f}", va='center', fontsize=7)
    ax.set_xlabel('Normalized influence (%)')
    ax.set_title(title, loc='left', fontweight='bold')
    ax.grid(axis='x', alpha=.15)
    ax.set_axisbelow(True)


def figure1():
    fig, ax = plt.subplots(figsize=(7.2, 4.5))
    ax.set(xlim=(0, 10), ylim=(0, 10)); ax.axis('off')
    def box(x, y, w, h, title, detail, color):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0.04',
                                   linewidth=1, edgecolor='#536777', facecolor=color))
        ax.text(x+w/2, y+h*.7, title, ha='center', va='center', fontsize=8, fontweight='bold')
        ax.text(x+w/2, y+h*.3, detail, ha='center', va='center', fontsize=6.6, linespacing=1.3)
    stages = [
        ('Input', 'Survival observations and treatment conditions', '#E5EDE8'),
        ('Primary fitting', '11 models · bounded least squares · Gaussian AICc', '#E6E9F1'),
        ('Primary output', 'Parameters · uncertainty · survival curves', '#DCECEE'),
        ('Secondary fitting', 'Factor–response regression · 43 model forms', '#E6E9F1'),
        ('Secondary output', 'Response surfaces · hold-out diagnostics', '#DCECEE'),
        ('Dynamic simulation', 'Profile breakpoints · Simpson quadrature', '#E6E9F1'),
        ('Simulation output', 'Survival trajectories · cumulative exposure', '#DCECEE'),
    ]
    ys = np.linspace(8.65, .25, len(stages))
    for y, (title, detail, color) in zip(ys, stages): box(2.8,y,4.4,1.0,title,detail,color)
    for top, bottom in zip(ys[:-1],ys[1:]):
        ax.annotate('',xy=(5,bottom+1.02),xytext=(5,top-.03),arrowprops={'arrowstyle':'->','color':'#536777'})
    box(.05, 3.5, 2.35, 2.75, 'Sensitivity screening',
        'OAT: local perturbation\nSRC: relative regression influence\nMorris: elementary effects\nSobol: overlapping total effects\nRanges and sampling diagnostics', '#F1E9DD')
    box(7.6, 3.5, 2.35, 2.75, 'Uncertainty propagation',
        'Monte Carlo sampling\nPrimary and secondary covariance\nProcess-factor variability\nDraw-specific reduction targets\nPercentiles and stability diagnostics', '#F1E9DD')
    for y in [ys[2]+.5,ys[4]+.5]:
        ax.annotate('',xy=(2.4,4.85),xytext=(2.8,y),arrowprops={'arrowstyle':'->','color':'#536777','linestyle':'--'})
        ax.annotate('',xy=(7.6,4.85),xytext=(7.2,y),arrowprops={'arrowstyle':'->','color':'#536777','linestyle':'--'})
    fig.subplots_adjust(left=.01,right=.99,bottom=.01,top=.99)
    save(fig,'figure1_workflow')


def figure4():
    d = load('figure4_holdout'); pm = d['parameterMetrics']; cm = d['curveMetrics']
    point = pm['points'][0]
    fig = plt.figure(figsize=(7.2, 4.8), layout='constrained')
    gs = fig.add_gridspec(2, 2, height_ratios=[1,1.4])
    ax = fig.add_subplot(gs[0,0])
    values = [point['observedRaw'], point['predictedRaw']]
    ax.bar(['Observed primary fit','Secondary prediction'], values,color=['#8297A6','#244C74'],width=.5)
    for x,y in enumerate(values): ax.text(x,y+.4,f'{y:.2f}',ha='center',fontsize=8)
    ax.set(ylabel='D (min)',ylim=(0,22)); ax.set_title('A  Held-out parameter comparison',loc='left',fontweight='bold')
    ax = fig.add_subplot(gs[0,1]);ax.axis('off')
    ax.text(0,.95,'Held-out condition: 60 °C; aw = 0.50\n\n'
            f"Parameter Bf = Af = {pm['Bf']:.3f}\n\nRMSE = {pm['RMSE']:.3f} on log₁₀(D) scale\n\n"
            'One held-out condition; not a validation verdict.',va='top',fontsize=8)
    ax = fig.add_subplot(gs[1,:]); points=cm['points'];ts=np.array([p['t'] for p in points])
    ax.scatter(ts,[p['observed'] for p in points],s=20,color='#244C74',label='Held-out observations')
    t=np.linspace(0,max(ts),200);p=d['conditionalParams'];pf=d['primaryFit']['params']
    ax.plot(t,p['logN0']-p['kmax']*t/np.log(10),color='#438D93',label='Conditional secondary prediction')
    ax.plot(t,pf['logN0']-pf['kmax']*t/np.log(10),'--',color='#87919B',label='Held-out primary fit')
    ax.set(xlabel='Time (min)',ylabel=r'$\log_{10} N$',ylim=(2.8,7.7))
    ax.set_title(f"B  Conditional survival comparison (n = {cm['n']}; RMSE = {cm['RMSE']:.3f})",loc='left',fontweight='bold')
    ax.text(.98,.95,f"Bf = {cm['Bf']:.3f}; Af = {cm['Af']:.3f}",transform=ax.transAxes,ha='right',va='top')
    ax.legend(loc='lower left',frameon=False)
    save(fig,'figure4_holdout')


def figure3():
    sec = load('t1_all_secondary_fits')['EXTENDED_BIGELOW_D']
    points = load('figure3_secondary_points')
    with (DATA / 'figure3_surface.csv').open() as f:
        rows = list(csv.DictReader(f))
    x = np.array([float(r['temp']) for r in rows]).reshape(65, 65)
    y = np.array([float(r['aw']) for r in rows]).reshape(65, 65)
    z = np.array([float(r['logD']) for r in rows]).reshape(65, 65)
    fig = plt.figure(figsize=(7.2, 4.45), layout='constrained')
    gs = fig.add_gridspec(2, 2, width_ratios=[1.05, 1])
    ax = fig.add_subplot(gs[:, 0], projection='3d')
    surf = ax.plot_surface(x, y, z, cmap='viridis', alpha=.82, linewidth=0)
    ax.scatter([p['factors']['temp'] for p in points],
               [p['factors']['aw'] for p in points], [p['y'] for p in points],
               c='#C94B55', s=22, edgecolors='white', linewidths=.4, depthshade=False)
    ax.set_xlabel('Temperature (°C)', labelpad=3)
    ax.set_ylabel('Water activity', labelpad=3)
    ax.set_zlabel('')
    ax.text2D(.02, .92, r'Surface and red points: $\log_{10}(D/\mathrm{min})$',
              fontsize=7, transform=ax.transAxes)
    ax.set_title('A  Secondary response surface', loc='left', fontweight='bold')
    ax.view_init(elev=25, azim=-55)
    ax.tick_params(labelsize=6)
    ax = fig.add_subplot(gs[0, 1])
    xx = [p['observedD'] for p in points]
    yy = [p['predictedD'] for p in points]
    ax.scatter(xx, yy, color='#244C74', s=22)
    ax.plot([0, 60], [0, 60], '--', color='#999999', lw=1)
    ax.set(xlim=(0, 60), ylim=(0, 60), xlabel='Observed D (min)', ylabel='Predicted D (min)')
    ax.set_title('B  Condition-level agreement', loc='left', fontweight='bold')
    ax = fig.add_subplot(gs[1, 1]); ax.axis('off')
    pp = sec['params']
    lines = [f"Conditions: n = {sec['n']}",
             f"log₁₀(D) RMSE = {sec['rmse']:.3f}; adjusted R² = {sec['r2adj']:.3f}",
             f"Linked survival RMSE = {sec['linkedCurveMetrics']['rmse']:.3f} (n = 114)",
             f"Dref = {10**pp['logDref']:.2f} min; Tref = 70 °C; aw,ref = 0.33",
             f"zT = {pp['zT']:.2f} °C; zaw = {pp['zaw']:.3f}",
             f"AICc = {sec['aicc']:.2f} on the observed D scale",
             'Surface: predicted log₁₀(D); red points: fitted primary D.']
    ax.text(0, .94, '\n\n'.join(lines), fontsize=7.3, va='top', transform=ax.transAxes)
    save(fig, 'figure3_secondary')


def figure6():
    raw = load('figure6_mc_raw')
    summary = load('figure6_mc_summary')['summary']
    sens = load('sensitivity_results')
    fig = plt.figure(figsize=(7.2, 5.25), layout='constrained')
    gs = fig.add_gridspec(2, 2, height_ratios=[1, 1.3], hspace=.18, wspace=.1)
    ax = fig.add_subplot(gs[0, 0])
    b = raw['bands']; t = np.array([r['t'] for r in b]); selected = t <= 25
    v = lambda field: np.array([r[field] for r in b])[selected]
    ax.fill_between(t[selected], v('p5'), v('p95'), color='#BDD5E8', label='5–95%')
    ax.fill_between(t[selected], v('p25'), v('p75'), color='#80AFD1', label='25–75%')
    ax.plot(t[selected], v('p50'), color='#244C74', lw=1.2, label='Median')
    ax.axvline(6, ls=':', color='#777777', lw=.8)
    ax.set(xlabel='Time (min)', ylabel=r'$\log_{10} N$', xlim=(0, 25))
    ax.set_title('A  Monte Carlo survival distribution', loc='left', fontweight='bold')
    ax.legend(loc='lower left', frameon=False, ncol=3, fontsize=6)
    ax = fig.add_subplot(gs[0, 1])
    # Attainment is draw-specific, so display the actual reduction distribution.
    ax.hist(raw['reduction6'], bins=40, color='#80AFD1', edgecolor='white', linewidth=.3)
    ax.axvline(5, ls='--', color='#BB6677')
    ax.set(xlabel='Draw-specific log₁₀ reduction at 6 min', ylabel='Iterations')
    ax.set_title(f"{summary['successPercent']:.1f}% achieved target at 6 min", loc='left', fontsize=9)
    ax.text(.98, .96, f"{summary['successCount']:,}/10,000 iterations\n99% time-to-target: {summary['safeTimeUI']:.1f} min",
            va='top', ha='right', fontsize=7, transform=ax.transAxes)
    ax = fig.add_subplot(gs[1, 0]); bars(ax, sens['oat'], 'B  Local OAT (±5%)')
    ax = fig.add_subplot(gs[1, 1]); bars(ax, sens['src'], f"C  SRC screening (R² = {sens['src']['rSquared']:.3f})", noise=True)
    fig.legend(handles=[Patch(color=c, label=l) for c, l in zip(COLORS.values(), ['Process factors', 'Primary uncertainty', 'Secondary uncertainty'])],
               loc='outside lower center', ncol=3, frameon=False)
    save(fig, 'figure6_uncertainty')


def supplement_figures():
    sens = load('sensitivity_results')
    for method, title, name in [('morris', 'Morris elementary-effects screening', 'figureS1_morris'),
                                ('sobol', 'Sobol total-effect screening', 'figureS2_sobol')]:
        fig, ax = plt.subplots(figsize=(7.2, 3.2), layout='constrained')
        bars(ax, sens[method], title)
        if method == 'morris':
            ax.set_xlabel('Normalized mean absolute elementary effect (%)')
        else:
            ax.set_xlabel('Normalized total-effect estimate (%)')
            ax.text(.99, .98, f"ΣST = {sens[method]['sumST']:.3f}; N = 512", ha='right', va='top', transform=ax.transAxes)
        fig.legend(handles=[Patch(color=c, label=l) for c, l in zip(COLORS.values(), ['Process factors', 'Primary parameters', 'Secondary parameters'])],
                   loc='outside lower center', ncol=3, frameon=False)
        save(fig, name)


if __name__ == '__main__':
    figure1(); figure3(); figure4(); figure6(); supplement_figures()
    print(OUT)
