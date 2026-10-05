#!/bin/sh
# 按需打包 ECharts：只带页面用到的图表和组件，产物提交进仓库，路由器上不需要 node 也不走 CDN。
# 用法：scripts/build-echarts.sh   （需要 node / npm）
set -eu

ECHARTS=6.1.0
ESBUILD=0.28.2

cd "$(dirname "$0")/.."
out=htdocs/luci-static/resources/mihomo-traffic
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat > "$work/entry.js" <<'JS'
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart, SankeyChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([ LineChart, BarChart, PieChart, SankeyChart,
	GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
	LabelLayout, CanvasRenderer ]);

export default echarts;
JS

(cd "$work" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund "echarts@$ECHARTS" "esbuild@$ESBUILD")
"$work/node_modules/.bin/esbuild" "$work/entry.js" --bundle --minify --format=iife \
	--global-name=echarts --footer:js='echarts=echarts.default;' \
	--legal-comments=none --target=es2018 --outfile="$out/echarts.min.js"
cp "$work/node_modules/echarts/LICENSE" "$out/ECHARTS-LICENSE"
printf 'echarts %s (custom build)\n' "$ECHARTS" > "$out/ECHARTS-VERSION"
ls -l "$out"
