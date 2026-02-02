import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Shield, UserCog, AlertCircle, CheckCircle, UserPlus, Edit2, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import DataState from '../components/DataState';
import NavigationHero from '../components/NavigationHero';

export default function Admin() {
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;
  const { user, role, apiFetch } = useAuth();

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({ title: "Admin", showFilters: false });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [updating, setUpdating] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [newUser, setNewUser] = useState({ nome: '', email: '', password: '', role: 'analista' });

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await apiFetch('/api/admin/users');
      setUsers(Array.isArray(payload?.users) ? payload.users : []);
    } catch (err) {
      console.error('Erro ao buscar usuarios:', err);
      setError('Erro ao carregar lista de usuarios: ' + (err?.message || 'falha desconhecida'));
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId, newRole) => {
    if (!newRole) return;
    try {
      setUpdating(userId);
      setError('');
      setSuccess('');

      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: { role: newRole },
      });

      setSuccess(`Role atualizada para ${newRole} com sucesso!`);
      await fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Erro ao atualizar role:', err);
      setError('Erro ao atualizar role: ' + (err?.message || 'falha desconhecida'));
    } finally {
      setUpdating(null);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setSuccess('');

      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: newUser,
      });

      setSuccess('Usuário adicionado com sucesso!');
      setShowAddModal(false);
      setNewUser({ nome: '', email: '', password: '', role: 'analista' });
      await fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Erro ao adicionar usuário:', err);
      setError('Erro ao adicionar usuário: ' + (err?.message || 'falha desconhecida'));
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      setError('');
      setSuccess('');

      const updateData = {
        nome: editingUser.nome,
        email: editingUser.email,
        role: editingUser.role,
      };

      if (editingUser.password) {
        updateData.password = editingUser.password;
      }

      await apiFetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: updateData,
      });

      setSuccess('Usuário atualizado com sucesso!');
      setShowEditModal(false);
      setEditingUser(null);
      await fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Erro ao atualizar usuário:', err);
      setError('Erro ao atualizar usuário: ' + (err?.message || 'falha desconhecida'));
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`Tem certeza que deseja excluir o usuário "${userName}"?`)) {
      return;
    }

    try {
      setError('');
      setSuccess('');

      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      });

      setSuccess('Usuário excluído com sucesso!');
      await fetchUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Erro ao excluir usuário:', err);
      setError('Erro ao excluir usuário: ' + (err?.message || 'falha desconhecida'));
    }
  };

  const openEditModal = (u) => {
    setEditingUser({ ...u, password: '' });
    setShowEditModal(true);
  };

  if (role !== 'admin') {
    return (
      <div className="instagram-dashboard--clean">
        <div className="ig-clean-container">
          <NavigationHero title="Admin" icon={Shield} showGradient={false} />

          <div className="page-content">
            <div className="ig-main-layout">
              <div className="ig-content-area">
                <div className="ig-card-white" style={{ textAlign: 'center', padding: '3rem' }}>
                  <Shield size={48} style={{ marginBottom: '1rem', color: '#ec4899' }} />
                  <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: '600' }}>Acesso Negado</h2>
                  <p style={{ color: '#6b7280', marginBottom: '0.5rem' }}>
                    Você não tem permissão para acessar esta página.
                  </p>
                  <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                    Apenas usuários com role <strong>admin</strong> podem gerenciar usuários.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="instagram-dashboard--clean">
      <div className="ig-clean-container">
        <NavigationHero title="Admin" icon={Shield} showGradient={false} />

        <div className="page-content">
          <div className="ig-main-layout">
            <div className="ig-content-area">
              <section className="ig-card-white" style={{ marginBottom: '2rem' }}>
              <div className="ig-analytics-card__header" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#111827' }}>Gerenciamento de Usuários</h4>
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    Gerencie roles e permissões dos usuários do sistema.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.625rem 1.25rem',
                    backgroundColor: '#ec4899',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#db2777'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ec4899'}
                >
                  <UserPlus size={18} />
                  Adicionar Usuário
                </button>
              </div>

              <div style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              padding: '1rem',
              marginBottom: '1rem',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#ef4444'
            }}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div style={{
              padding: '1rem',
              marginBottom: '1rem',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#22c55e'
            }}>
              <CheckCircle size={20} />
              <span>{success}</span>
            </div>
          )}

          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Role Atual</th>
                  <th>Data de Criacao</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                      <DataState state="loading" label="Carregando usuarios..." size="sm" inline />
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', fontStyle: 'italic', color: 'var(--muted)' }}>
                      Nenhum usuario cadastrado.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <UserCog size={16} />
                          <strong>{u.nome || 'Sem nome'}</strong>
                          {u.id === user?.id && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>(voce)</span>
                          )}
                        </div>
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
                        {u.email}
                      </td>
                      <td>
                        <span style={{
                          padding: '0.25rem 0.75rem',
                          borderRadius: '1rem',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          backgroundColor: u.role === 'admin' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                          color: u.role === 'admin' ? '#3b82f6' : '#6b7280'
                        }}>
                          {u.role}
                        </span>
                      </td>
                      <td>{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => openEditModal(u)}
                            disabled={updating === u.id}
                            style={{
                              padding: '0.5rem',
                              backgroundColor: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.375rem',
                              cursor: updating === u.id ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: updating === u.id ? 0.5 : 1
                            }}
                            title="Editar usuário"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u.id, u.nome)}
                            disabled={updating === u.id || u.id === user?.id}
                            style={{
                              padding: '0.5rem',
                              backgroundColor: u.id === user?.id ? '#9ca3af' : '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.375rem',
                              cursor: updating === u.id || u.id === user?.id ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: updating === u.id || u.id === user?.id ? 0.5 : 1
                            }}
                            title={u.id === user?.id ? 'Não pode excluir você mesmo' : 'Excluir usuário'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            color: '#6b7280'
          }}>
            <strong style={{ color: '#111827' }}>Informações sobre Roles:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
              <li><strong>Analista:</strong> Pode visualizar dashboards e relatórios.</li>
              <li><strong>Admin:</strong> Tem acesso total, incluindo gerenciamento de usuários.</li>
            </ul>
          </div>
              </div>
            </section>
            </div>
          </div>
        </div>

        {/* Modal Adicionar Usuário */}
        {showAddModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '0.75rem',
              padding: '2rem',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6b7280'
                }}
              >
                <X size={24} />
              </button>

              <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem', color: '#111827' }}>
                Adicionar Novo Usuário
              </h3>

              <form onSubmit={handleAddUser}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={newUser.nome}
                    onChange={(e) => setNewUser({ ...newUser, nome: e.target.value })}
                    required
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    required
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Senha
                  </label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    minLength={6}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Role
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="analista">Analista</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: '#e5e7eb',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: '#ec4899',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Adicionar Usuário
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Editar Usuário */}
        {showEditModal && editingUser && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '0.75rem',
              padding: '2rem',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingUser(null);
                }}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6b7280'
                }}
              >
                <X size={24} />
              </button>

              <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem', color: '#111827' }}>
                Editar Usuário
              </h3>

              <form onSubmit={handleEditUser}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={editingUser.nome}
                    onChange={(e) => setEditingUser({ ...editingUser, nome: e.target.value })}
                    required
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={editingUser.email}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    required
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Nova Senha (deixe em branco para manter a atual)
                  </label>
                  <input
                    type="password"
                    value={editingUser.password}
                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                    minLength={6}
                    placeholder="••••••"
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                    Role
                  </label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                    disabled={editingUser.id === user?.id}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '0.375rem',
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem',
                      cursor: editingUser.id === user?.id ? 'not-allowed' : 'pointer',
                      opacity: editingUser.id === user?.id ? 0.6 : 1
                    }}
                  >
                    <option value="analista">Analista</option>
                    <option value="admin">Admin</option>
                  </select>
                  {editingUser.id === user?.id && (
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      Você não pode alterar sua própria role
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingUser(null);
                    }}
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: '#e5e7eb',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Salvar Alterações
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

