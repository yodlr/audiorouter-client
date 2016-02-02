FROM node:4
MAINTAINER Ross Kukulinski "ross@getyodlr.com"

WORKDIR /src

ADD package.json /src/package.json
RUN npm install

ADD . /src/

# environment
CMD ["/usr/local/bin/npm", "test"]
