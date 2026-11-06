// In-memory overlay; upstream release metadata remains the version source.
module.exports = function brand(config) {
  const upstream = config.brands.release;
  if (!upstream?.release?.displayVersion) throw new Error('Missing upstream Zen displayVersion');
  config.name = 'Zyn';
  config.appId = 'browser'; // distribution id app.zyn + browser = app.zyn.browser
  config.brands.zyn = {
    ...upstream,
    brandShorterName: 'Zyn', brandShortName: 'Zyn', brandFullName: 'Zyn',
    release: { ...upstream.release, displayVersion: `${upstream.release.displayVersion}-zyn` },
  };
  return config;
};
