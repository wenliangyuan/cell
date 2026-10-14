// The courseware's content spine: six chapters, each a self-contained 3D world.
//
// Every chapter owns its own camera choreography, colour grade and 3D annotation
// anchors, so switching chapters is a full cinematic cut rather than a filter.

export const SCENES = [
  /* ══════════════════════════════════════════════════════════ 00 · 细胞全景 */
  {
    id: 'overview',
    index: '00',
    title: '细胞全景',
    latin: 'The Cell · Overview',
    accent: '#5ef3ff',
    duration: 34,
    caption: `一颗直径约 <b>20 微米</b> 的封闭宇宙。细胞膜划出边界，细胞质里悬浮着各司其职的细胞器——
              它们彼此不接触，却通过囊泡、离子与分子信号持续对话。这不是一张静态解剖图，而是一座
              每秒进行数百万次化学反应的城市。`,
    grade: {
      exposure: 0.88, bloom: 0.44, rays: 0.34, saturation: 1.06, contrast: 1.10,
      chroma: 0.0030, vignette: 0.86, grain: 0.014,
      lift: [0.012, 0.022, 0.040], gain: [1.02, 1.00, 0.99],
      raysTint: [0.56, 0.85, 1.00],
    },
    keys: [
      { pos: [0, 3, 62], look: [0, 0, 0], fov: 36, roll: 0.0, focus: 62, aperture: 0.22 },
      { pos: [28, 13, 50], look: [0, 0.5, 0], fov: 40, roll: 0.04, focus: 56, aperture: 0.26 },
      { pos: [46, -6, 18], look: [0, 0, 0], fov: 34, roll: -0.03, focus: 48, aperture: 0.24 },
      { pos: [16, -16, -50], look: [0, 0, 0], fov: 42, roll: 0.05, focus: 54, aperture: 0.28 },
      { pos: [-34, 9, -42], look: [0, 0.5, 0], fov: 38, roll: -0.05, focus: 56, aperture: 0.26 },
      { pos: [-12, 2, 60], look: [0, 0, 0], fov: 36, roll: 0.0, focus: 60, aperture: 0.22 },
    ],
    markers: [
      { pos: [0, 0, 0], name: '细胞核', en: 'Nucleus' },
      { pos: [11.5, 3.6, 4.2], name: '线粒体', en: 'Mitochondria' },
      { pos: [-9.8, -4.4, 5.6], name: '内质网', en: 'Endoplasmic Reticulum' },
      { pos: [-4.2, 6.2, -8.4], name: '高尔基体', en: 'Golgi Apparatus' },
      { pos: [0, -11.4, 0], name: '细胞膜', en: 'Plasma Membrane' },
    ],
  },

  /* ═══════════════════════════════════════════════════ 01 · 细胞膜 / 流动镶嵌 */
  {
    id: 'membrane',
    index: '01',
    title: '细胞膜',
    latin: 'Plasma Membrane · Fluid Mosaic',
    accent: '#37e0ff',
    duration: 32,
    caption: `两层磷脂分子尾对尾排成 <b>5 纳米</b> 厚的双分子层：亲水头部朝外，疏水尾部向内。
              它既不是墙壁也不是筛子，而是一片流动的二维液体——蛋白质像浮岛一样在脂海中漂移，
              胆固醇调节着它的柔韧度。物质的进出，全由这套镶嵌结构决定。`,
    grade: {
      exposure: 0.94, bloom: 0.50, rays: 0.40, saturation: 1.10, contrast: 1.10,
      chroma: 0.0034, vignette: 0.84, grain: 0.014,
      lift: [0.010, 0.022, 0.042], gain: [0.99, 1.01, 1.02],
      raysTint: [0.50, 0.88, 1.00],
    },
    keys: [
      { pos: [0, 14, 30], look: [0, 0, 0], fov: 42, roll: 0.0, focus: 30, aperture: 0.30 },
      { pos: [0, 5.2, 20], look: [0, 0, 0], fov: 40, roll: 0.02, focus: 19, aperture: 0.34 },
      { pos: [6, 2.2, 11], look: [0, 0.1, 0], fov: 46, roll: -0.04, focus: 10, aperture: 0.42 },
      { pos: [2.0, 1.1, 5.0], look: [0.4, 0, 0], fov: 52, roll: 0.06, focus: 4.4, aperture: 0.50 },
      { pos: [-4.4, 2.4, 7.4], look: [0, 0, 0], fov: 46, roll: -0.05, focus: 8, aperture: 0.40 },
      { pos: [0, 8.0, 24], look: [0, 0, 0], fov: 42, roll: 0.0, focus: 24, aperture: 0.32 },
    ],
    markers: [
      { pos: [0, 1.5, 0], name: '磷脂双分子层', en: 'Lipid Bilayer' },
      { pos: [5.4, 1.1, 3.2], name: '整合膜蛋白', en: 'Integral Protein' },
      { pos: [-5.6, 1.0, 2.8], name: '胆固醇', en: 'Cholesterol' },
      { pos: [3.0, 2.6, -5.0], name: '糖萼', en: 'Glycocalyx' },
    ],
  },

  /* ══════════════════════════════════════════════════════════ 02 · 细胞核 */
  {
    id: 'nucleus',
    index: '02',
    title: '细胞核',
    latin: 'Nucleus · Genome Vault',
    accent: '#ff3d9a',
    duration: 34,
    caption: `双层核膜把基因组保护在中央。每个细胞核里塞着约 <b>2 米</b> 长的 DNA，
              它们缠绕在组蛋白上形成染色质，再折叠成显微镜下可见的染色体。
              核膜上数以千计的核孔复合体，是 RNA 与蛋白质进出这道防线的唯一闸门。`,
    grade: {
      exposure: 0.92, bloom: 0.52, rays: 0.34, saturation: 1.12, contrast: 1.10,
      chroma: 0.0036, vignette: 0.86, grain: 0.014,
      lift: [0.024, 0.008, 0.026], gain: [1.03, 0.99, 1.02],
      raysTint: [1.00, 0.62, 0.86],
    },
    keys: [
      // Nucleus radius is 5.2, so the rig has to stay beyond ~30 units for the
      // whole organelle to sit in frame instead of filling it.
      { pos: [0, 1.0, 34], look: [0, 0, 0], fov: 38, roll: 0.0, focus: 34, aperture: 0.22 },
      { pos: [13, 9.0, 24], look: [0, 0, 0], fov: 42, roll: 0.05, focus: 28, aperture: 0.26 },
      { pos: [-9.0, 2.0, 19.0], look: [0, 0, 0], fov: 36, roll: -0.04, focus: 21, aperture: 0.24 },
      { pos: [6.0, 3.4, 15.5], look: [1.2, 0.3, 0], fov: 44, roll: 0.06, focus: 17, aperture: 0.30 },
      { pos: [-4.0, -6.0, 17.0], look: [0, -1.0, 0], fov: 40, roll: -0.05, focus: 18, aperture: 0.26 },
      { pos: [0, 3.4, 32], look: [0, 0, 0], fov: 38, roll: 0.0, focus: 32, aperture: 0.22 },
    ],
    markers: [
      { pos: [0, 0, 0], name: '染色质', en: 'Chromatin' },
      { pos: [4.4, 3.0, 3.4], name: '核孔复合体', en: 'Nuclear Pore' },
      { pos: [-3.6, -3.2, 3.6], name: '核仁', en: 'Nucleolus' },
      { pos: [0, 6.4, 0], name: '双层核膜', en: 'Nuclear Envelope' },
    ],
  },

  /* ════════════════════════════════════════════════════════ 03 · 线粒体 */
  {
    id: 'mitochondrion',
    index: '03',
    title: '线粒体',
    latin: 'Mitochondrion · Powerhouse',
    accent: '#ffb347',
    duration: 34,
    caption: `外膜之内，内膜反复折叠成 <b>嵴</b>，把有限的体积铺展出巨大的反应面积。
              电子传递链把电子一级级传下去，同时把质子泵进膜间隙，形成电化学梯度；
              质子涌回基质时推动 ATP 合成酶旋转——这个每秒约 <b>130 转</b> 的分子马达，
              就是生命通用能量货币的铸造机。`,
    grade: {
      exposure: 0.90, bloom: 0.48, rays: 0.36, saturation: 1.12, contrast: 1.10,
      chroma: 0.0032, vignette: 0.86, grain: 0.014,
      lift: [0.032, 0.020, 0.006], gain: [1.04, 1.00, 0.96],
      raysTint: [1.00, 0.80, 0.48],
    },
    keys: [
      // The organelle is ~9.5 long, so the rig orbits at 22–32 units. Any closer
      // and the camera ends up inside the outer membrane.
      { pos: [0, 3, 32], look: [0, 0, 0], fov: 42, roll: 0.0, focus: 32, aperture: 0.24 },
      { pos: [17, 7, 20], look: [0, 0, 0], fov: 44, roll: 0.04, focus: 27, aperture: 0.26 },
      { pos: [7, 1.5, 22], look: [0, 0, 0], fov: 40, roll: -0.05, focus: 23, aperture: 0.26 },
      { pos: [2.0, 1.0, 17.0], look: [0.6, 0, 0], fov: 46, roll: 0.07, focus: 18, aperture: 0.30 },
      { pos: [-10, 5.0, -20], look: [0, 0, 0], fov: 44, roll: -0.04, focus: 24, aperture: 0.26 },
      { pos: [-3, 1.5, 28], look: [0, 0, 0], fov: 42, roll: 0.0, focus: 28, aperture: 0.24 },
    ],
    markers: [
      { pos: [0, 0, 0], name: '线粒体基质', en: 'Matrix' },
      { pos: [5.2, 2.2, 2.0], name: '嵴', en: 'Cristae' },
      { pos: [-5.0, -1.6, 3.0], name: '电子传递链', en: 'Electron Transport Chain' },
      { pos: [1.6, -3.4, -3.6], name: 'ATP 合成酶', en: 'ATP Synthase' },
    ],
  },

  /* ══════════════════════════════════════════════════ 04 · 蛋白流水线 */
  {
    id: 'protein',
    index: '04',
    title: '蛋白流水线',
    latin: 'Protein Highway · Ribosome → Golgi',
    accent: '#2affc0',
    duration: 36,
    caption: `基因被抄写成 mRNA 后离开细胞核，核糖体读着密码子把氨基酸连成肽链。
              带信号肽的蛋白被送进 <b>粗面内质网</b> 折叠加工，再装入运输囊泡送往
              <b>高尔基体</b> 进行修饰与分拣，最终贴上地址标签，被精确投递到细胞的某个角落。`,
    grade: {
      exposure: 0.92, bloom: 0.50, rays: 0.36, saturation: 1.08, contrast: 1.09,
      chroma: 0.0030, vignette: 0.84, grain: 0.014,
      lift: [0.010, 0.030, 0.026], gain: [0.99, 1.02, 1.00],
      raysTint: [0.52, 1.00, 0.84],
    },
    keys: [
      // The pipeline spans x ≈ -13 … +13, so the rig has to sit well back to
      // hold all four stations in frame at once.
      { pos: [2, 4, 54], look: [0, 0, 0], fov: 38, roll: 0.0, focus: 54, aperture: 0.20 },
      { pos: [-20, 14, 40], look: [-3, 0, 0], fov: 42, roll: 0.05, focus: 46, aperture: 0.22 },
      { pos: [-8, 6, 30], look: [-4, 0.5, 0], fov: 40, roll: -0.04, focus: 32, aperture: 0.24 },
      { pos: [6, 3, 28], look: [2, 0, 0], fov: 42, roll: 0.05, focus: 29, aperture: 0.24 },
      { pos: [16, -5, 26], look: [6, -0.5, 0], fov: 42, roll: -0.06, focus: 30, aperture: 0.24 },
      { pos: [4, 4, 48], look: [0, 0, 0], fov: 40, roll: 0.0, focus: 48, aperture: 0.20 },
    ],
    markers: [
      { pos: [-11.5, 2.6, 0], name: '核糖体', en: 'Ribosome' },
      { pos: [-5.0, 1.0, 1.0], name: '粗面内质网', en: 'Rough ER' },
      { pos: [4.6, 1.2, 0], name: '高尔基体', en: 'Golgi Apparatus' },
      { pos: [11.0, -1.6, 1.6], name: '分泌囊泡', en: 'Secretory Vesicle' },
    ],
  },

  /* ══════════════════════════════════════════════════════════ 05 · 有丝分裂 */
  {
    id: 'mitosis',
    index: '05',
    title: '有丝分裂',
    latin: 'Mitosis · One Becomes Two',
    accent: '#8b5cf6',
    duration: 38,
    caption: `染色质凝缩成棒状的染色体，每条已复制为两条姐妹染色单体。
              纺锤丝从两极抓住着丝粒，把染色体整齐排到赤道板上；
              随后姐妹染色单体被拉开、分别移向两极，细胞中部缩窄，
              一个细胞就此变成两个——遗传信息被精确地一分为二。`,
    grade: {
      exposure: 0.90, bloom: 0.50, rays: 0.36, saturation: 1.12, contrast: 1.10,
      chroma: 0.0038, vignette: 0.86, grain: 0.014,
      lift: [0.018, 0.014, 0.040], gain: [1.02, 0.99, 1.04],
      raysTint: [0.72, 0.66, 1.00],
    },
    keys: [
      // The cell stretches to ~30 units across once the chromatids separate, so
      // the rig stays wide through anaphase instead of chasing the plate.
      { pos: [0, 3, 46], look: [0, 0, 0], fov: 40, roll: 0.0, focus: 46, aperture: 0.20 },
      { pos: [16, 14, 38], look: [0, 0, 0], fov: 42, roll: 0.04, focus: 42, aperture: 0.22 },
      { pos: [0, 4, 32], look: [0, 0, 0], fov: 38, roll: -0.03, focus: 32, aperture: 0.24 },
      { pos: [5, 0.8, 26], look: [0, 0, 0], fov: 40, roll: 0.03, focus: 26, aperture: 0.26 },
      { pos: [0, -2, 44], look: [0, 0, 0], fov: 42, roll: -0.04, focus: 44, aperture: 0.22 },
      { pos: [-22, 5, 40], look: [0, 0, 0], fov: 42, roll: 0.05, focus: 44, aperture: 0.22 },
      { pos: [0, 3, 48], look: [0, 0, 0], fov: 40, roll: 0.0, focus: 48, aperture: 0.20 },
    ],
    markers: [
      { pos: [0, 0, 0], name: '染色体', en: 'Chromosome' },
      { pos: [0, 11.5, 0], name: '纺锤体', en: 'Spindle Apparatus' },
      { pos: [-7.5, -8.0, 0], name: '中心体', en: 'Centrosome' },
      { pos: [0, -8.6, 0], name: '赤道板', en: 'Metaphase Plate' },
    ],
  },
];

export const TOTAL_DURATION = SCENES.reduce((a, s) => a + s.duration, 0);

/** Start time of each chapter on the global timeline. */
export const SCENE_STARTS = (() => {
  const out = [];
  let acc = 0;
  for (const s of SCENES) { out.push(acc); acc += s.duration; }
  return out;
})();

export function sceneAt(globalTime) {
  let i = 0;
  for (let k = 0; k < SCENES.length; k++) if (globalTime >= SCENE_STARTS[k]) i = k;
  return i;
}
