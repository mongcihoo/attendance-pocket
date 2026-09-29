#!/usr/bin/env ruby
require 'json'

root = File.expand_path('..', __dir__)
manifest = JSON.parse(File.read(File.join(root, 'manifest.webmanifest'), encoding: 'UTF-8'))
raise 'manifest display 必须为 standalone' unless manifest['display'] == 'standalone'
raise 'start_url 必须为相对地址' unless manifest['start_url'].start_with?('./')
raise 'scope 必须为 ./' unless manifest['scope'] == './'

def png_size(path)
  data = File.binread(path, 24)
  raise "#{path} 不是 PNG" unless data.start_with?("\x89PNG\r\n\x1a\n".b)
  data.byteslice(16, 8).unpack('NN')
end

manifest.fetch('icons').each do |icon|
  path = File.join(root, icon.fetch('src'))
  raise "缺少 #{icon['src']}" unless File.file?(path)
  expected = icon.fetch('sizes').split('x').map(&:to_i)
  raise "#{icon['src']} 尺寸不符" unless png_size(path) == expected
end

required = %w[
  index.html styles.css app.js manifest.webmanifest sw.js
  icons/apple-touch-icon.png icons/icon-192.png icons/icon-512.png
  icons/icon-maskable-512.png iOS/AttendancePocket.xcodeproj/project.pbxproj
]
required.each { |path| raise "缺少 #{path}" unless File.file?(File.join(root, path)) }

html = File.read(File.join(root, 'index.html'), encoding: 'UTF-8')
worker = File.read(File.join(root, 'sw.js'), encoding: 'UTF-8')
app = File.read(File.join(root, 'app.js'), encoding: 'UTF-8')

%w[styles.css?v=7 app.js?v=7 manifest.webmanifest apple-touch-icon.png].each do |item|
  raise "index.html 未引用 #{item}" unless html.include?(item)
end
%w[styles.css?v=7 app.js?v=7 manifest.webmanifest icon-maskable-512.png].each do |item|
  raise "sw.js 未预缓存 #{item}" unless worker.include?(item)
end
raise '更新切换消息不完整' unless worker.include?('SKIP_WAITING') && app.include?('SKIP_WAITING')
raise '未绕过旧 SW HTTP 缓存' unless app.include?("updateViaCache:'none'")
raise '缺少 iOS 文件分享支持' unless app.include?('navigator.canShare') && app.include?('new File')
raise '缺少 IndexedDB 数据层' unless app.include?('indexedDB.open')
raise '缺少持久存储请求' unless app.include?('navigator.storage?.persist')

puts 'PASS: manifest、图标、离线资源、更新策略、IndexedDB、文件分享与原生工程均完整'
