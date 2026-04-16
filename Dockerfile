FROM nginx:alpine

# 设置工作目录
WORKDIR /usr/share/nginx/html

# 清除默认 Nginx 静态文件
RUN rm -rf /usr/share/nginx/html/*

# 复制项目文件到 Nginx 目录
COPY . /usr/share/nginx/html/

# 复制 Nginx 配置文件
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
