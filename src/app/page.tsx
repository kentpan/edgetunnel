/**
 * / — 项目落地页(v1.1.0)
 *
 * 服务端读取维护者链接(OWNER_GITHUB / OWNER_TG, .env 或部署环境变量配置,
 * 默认 kentpan), 传入自研客户端组件渲染 —— 首页含免责声明、求 Star 与致谢。
 */
import HomeClient from '@/components/home-client';

export default function Home() {
  const ownerGithub = (process.env.OWNER_GITHUB || 'https://github.com/kentpan').trim();
  const ownerTg = (process.env.OWNER_TG || 'https://t.me/kentpan').trim();
  return <HomeClient ownerGithub={ownerGithub} ownerTg={ownerTg} />;
}
