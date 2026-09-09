import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '纱线进销存',
  description: '纱线进销存管理系统',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('yarn-ui:dark')==='1')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  )
}
