from django.urls import path

from . import views

urlpatterns = [
    path("scenario", views.scenario),
    path("chat/stream", views.chat_stream),
    path("feedback", views.feedback),
]
