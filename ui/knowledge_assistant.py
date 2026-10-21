from __future__ import annotations
import json
import streamlit as st
from api.server import ROOT, retrieve, generate

def render_knowledge_assistant():
    st.header('水利 AI 助手 · 可追溯知识检索')
    st.caption('内置中文专业与操作笔记；完整原文检索和 PDF / DOCX 导入请使用新版网页工作台。服务器配置模型后启用生成式解释。')
    if 'water_chat' not in st.session_state:st.session_state.water_chat=[]
    for message in st.session_state.water_chat:
        with st.chat_message(message['role']):st.write(message['content'])
    question=st.chat_input('提问：感潮河网、潮位边界、闸泵调度或平台操作')
    if question:
        st.session_state.water_chat.append({'role':'user','content':question})
        with st.chat_message('user'):st.write(question)
        hits=retrieve(question)
        response,status=generate(question,hits,st.session_state.water_chat[-9:-1])
        if status==200:answer=response['answer']
        elif hits:answer='当前为本地资料检索。\n\n'+'\n\n'.join('['+d['id']+'] '+d['title']+'\n'+d['content']+'\n建议步骤：'+d.get('steps','') for d in hits[:3])
        else:answer='资料库暂未找到足够相关的依据，请补充问题对象及边界条件。'
        with st.chat_message('assistant'):
            st.write(answer)
            catalog=json.loads((ROOT/'knowledge/catalog.json').read_text(encoding='utf-8'));sources={s['id']:s for s in catalog['sources']}
            for d in hits[:3]:
                source=sources.get(d['sourceId'],{})
                if source.get('url'):st.link_button(d['id']+' · '+source['title'],source['url'])
        st.session_state.water_chat.append({'role':'assistant','content':answer})
        st.session_state.water_chat=st.session_state.water_chat[-40:]
